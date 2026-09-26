import '../network/api_client.dart';
import '../network/api_error.dart';
import 'outbox.dart';

/// Result of trying to save a workout.
enum SaveOutcome { saved, queuedOffline }

/// Offline-first workout saving (docs §10).
///
/// Every workout carries a client UUID used as the Idempotency-Key: re-sending after a lost response is safe,
/// the server replays the stored result instead of creating a duplicate.
class WorkoutSyncService {
  WorkoutSyncService({required this.api, required this.store, DateTime Function()? now}) : _now = now ?? DateTime.now;

  final ApiClient api;
  final OutboxStore store;
  final DateTime Function() _now;
  Future<int>? _flushing;

  /// Tries the network first; on a connectivity problem the workout is queued and sent later.
  /// Server-side refusals (validation, anti-cheat) are rethrown so the form can show them.
  Future<(SaveOutcome, Map<String, dynamic>?)> save(Map<String, dynamic> workout) async {
    final clientId = workout['clientId'] as String;
    final payload = {...workout, 'deviceSubmittedAt': _now().toUtc().toIso8601String()};
    try {
      final res = await api.post<Map<String, dynamic>>('/workouts', data: payload, headers: {'Idempotency-Key': clientId});
      return (SaveOutcome.saved, res);
    } on ApiError catch (e) {
      if (e.kind != ApiErrorKind.network && e.kind != ApiErrorKind.timeout) rethrow;
      await store.put(OutboxItem(clientId: clientId, payload: workout, status: OutboxStatus.pending, attempts: 0, createdAt: _now()));
      return (SaveOutcome.queuedOffline, null);
    }
  }

  Future<List<OutboxItem>> pending() => store.all();

  /// Sends queued workouts in batches of 50. Concurrent calls share one flush. Returns how many were synced.
  Future<int> flush() => _flushing ??= _flush().whenComplete(() => _flushing = null);

  Future<int> _flush() async {
    final queued = (await store.all()).where((i) => i.status == OutboxStatus.pending).toList();
    var synced = 0;
    for (var i = 0; i < queued.length; i += 50) {
      final batch = queued.sublist(i, i + 50 > queued.length ? queued.length : i + 50);
      final Map<String, dynamic> res;
      try {
        res = await api.post<Map<String, dynamic>>('/workouts/sync', data: {
          'items': [for (final item in batch) {...item.payload, 'deviceSubmittedAt': _now().toUtc().toIso8601String()}],
        });
      } on ApiError catch (e) {
        if (e.kind == ApiErrorKind.network || e.kind == ApiErrorKind.timeout) {
          for (final item in batch) {
            await store.put(item.copyWith(attempts: item.attempts + 1));
          }
          return synced; // still offline: try again on the next trigger
        }
        rethrow;
      }
      final results = (res['results'] as List).cast<Map<String, dynamic>>();
      for (final r in results) {
        final item = batch.firstWhere((b) => b.clientId == r['clientId']);
        switch (r['result']) {
          case 'CREATED':
          case 'REPLAYED':
            await store.remove(item.clientId);
            synced++;
          case 'CONFLICT':
            await store.put(item.copyWith(status: OutboxStatus.conflict, lastError: 'IDEMPOTENCY_CONFLICT'));
          case 'REJECTED':
            await store.put(item.copyWith(status: OutboxStatus.rejected, lastError: 'WORKOUT_REJECTED'));
          default:
            final code = (r['error'] as Map?)?['code'] as String?;
            await store.put(item.copyWith(status: OutboxStatus.rejected, lastError: code ?? 'INVALID'));
        }
      }
    }
    return synced;
  }

  /// The user dismissed a conflicted or rejected item (the server version is kept).
  Future<void> discard(String clientId) => store.remove(clientId);
}
