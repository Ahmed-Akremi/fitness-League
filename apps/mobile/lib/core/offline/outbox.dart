import 'dart:convert';

/// A workout saved while offline, waiting to be sent (docs §10).
class OutboxItem {
  const OutboxItem({required this.clientId, required this.payload, required this.status, required this.attempts, required this.createdAt, this.lastError});

  final String clientId;
  final Map<String, dynamic> payload;
  final OutboxStatus status;
  final int attempts;
  final DateTime createdAt;
  final String? lastError;

  OutboxItem copyWith({OutboxStatus? status, int? attempts, String? lastError}) =>
      OutboxItem(clientId: clientId, payload: payload, status: status ?? this.status, attempts: attempts ?? this.attempts, createdAt: createdAt, lastError: lastError ?? this.lastError);

  String get payloadJson => jsonEncode(payload);
}

enum OutboxStatus {
  /// Waiting for connectivity.
  pending,

  /// The server already has this clientId with different data: the user must choose.
  conflict,

  /// The server refused it (validation or anti-cheat); kept so the user sees why.
  rejected,
}

/// Persistence of the outbox. Drift in the app, in-memory in tests.
abstract class OutboxStore {
  Future<void> put(OutboxItem item);
  Future<List<OutboxItem>> all();
  Future<void> remove(String clientId);
}

class MemoryOutboxStore implements OutboxStore {
  final Map<String, OutboxItem> _items = {};

  @override
  Future<void> put(OutboxItem item) async => _items[item.clientId] = item;

  @override
  Future<List<OutboxItem>> all() async => _items.values.toList()..sort((a, b) => a.createdAt.compareTo(b.createdAt));

  @override
  Future<void> remove(String clientId) async => _items.remove(clientId);
}
