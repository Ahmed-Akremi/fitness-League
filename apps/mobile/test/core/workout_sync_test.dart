import 'package:fitness_league/core/network/api_error.dart';
import 'package:fitness_league/core/offline/outbox.dart';
import 'package:fitness_league/core/offline/workout_sync_service.dart';
import 'package:flutter_test/flutter_test.dart';

import '../fake_api.dart';

Map<String, dynamic> workout(String clientId) => {
      'clientId': clientId,
      'sportId': 's',
      'workoutType': 'STRENGTH',
      'performedAt': '2026-09-25T07:00:00Z',
      'durationS': 3600,
      'exercises': [
        {
          'exerciseId': 'e',
          'sets': [
            {'reps': 5, 'weightKg': 100},
          ],
        },
      ],
    };

void main() {
  group('WorkoutSyncService (offline-first, spec §10)', () {
    test('sends online with the clientId as Idempotency-Key', () async {
      final backend = FakeBackend()..on('POST', '/workouts', (_) => (201, {'id': 'w1', 'status': 'ACCEPTED'}));
      final sync = WorkoutSyncService(api: fakeClient(backend), store: MemoryOutboxStore());
      final (outcome, body) = await sync.save(workout('c1'));
      expect(outcome, SaveOutcome.saved);
      expect(body!['id'], 'w1');
      expect(backend.requests.single.headers['Idempotency-Key'], 'c1');
    });

    test('queues when offline, then flushes in a batch and keeps conflicts for the user', () async {
      final backend = FakeBackend()..offline = true;
      final store = MemoryOutboxStore();
      final sync = WorkoutSyncService(api: fakeClient(backend), store: store);

      expect((await sync.save(workout('a'))).$1, SaveOutcome.queuedOffline);
      expect((await sync.save(workout('b'))).$1, SaveOutcome.queuedOffline);
      expect((await sync.save(workout('c'))).$1, SaveOutcome.queuedOffline);
      expect(await store.all(), hasLength(3));

      // Still offline: nothing lost, attempts counted.
      expect(await sync.flush(), 0);
      expect((await store.all()).every((i) => i.attempts == 1), isTrue);

      backend.offline = false;
      backend.on('POST', '/workouts/sync', (req) {
        final items = (req.data as Map)['items'] as List;
        expect(items.map((i) => i['clientId']), ['a', 'b', 'c']);
        return (200, {
          'results': [
            {'clientId': 'a', 'result': 'CREATED'},
            {'clientId': 'b', 'result': 'REPLAYED'},
            {'clientId': 'c', 'result': 'CONFLICT'},
          ],
        });
      });
      expect(await sync.flush(), 2);
      final left = await store.all();
      expect(left.single.clientId, 'c');
      expect(left.single.status, OutboxStatus.conflict);
    });

    test('rethrows server refusals so the form can show them (not queued)', () async {
      final backend = FakeBackend()..on('POST', '/workouts', (_) => (422, {'code': 'WORKOUT_REJECTED'}));
      final store = MemoryOutboxStore();
      final sync = WorkoutSyncService(api: fakeClient(backend), store: store);
      await expectLater(sync.save(workout('x')), throwsA(isA<ApiError>().having((e) => e.code, 'code', 'WORKOUT_REJECTED')));
      expect(await store.all(), isEmpty);
    });

    test('concurrent flushes share one request', () async {
      final backend = FakeBackend();
      final store = MemoryOutboxStore();
      await store.put(OutboxItem(clientId: 'a', payload: workout('a'), status: OutboxStatus.pending, attempts: 0, createdAt: DateTime(2026)));
      backend.on('POST', '/workouts/sync', (_) => (200, {
            'results': [
              {'clientId': 'a', 'result': 'CREATED'},
            ],
          }));
      final sync = WorkoutSyncService(api: fakeClient(backend), store: store);
      await Future.wait([sync.flush(), sync.flush()]);
      expect(backend.calls('POST', '/workouts/sync'), hasLength(1));
    });
  });
}
