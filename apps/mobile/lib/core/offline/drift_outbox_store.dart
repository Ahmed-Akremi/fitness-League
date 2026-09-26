import 'dart:convert';

import 'package:drift/drift.dart';
import 'package:drift_flutter/drift_flutter.dart';

import 'outbox.dart';

part 'drift_outbox_store.g.dart';

/// Offline outbox table (SQLite via Drift).
class OutboxWorkouts extends Table {
  TextColumn get clientId => text()();
  TextColumn get payload => text()();
  TextColumn get status => text()();
  IntColumn get attempts => integer().withDefault(const Constant(0))();
  TextColumn get lastError => text().nullable()();
  DateTimeColumn get createdAt => dateTime()();

  @override
  Set<Column> get primaryKey => {clientId};
}

@DriftDatabase(tables: [OutboxWorkouts])
class OfflineDatabase extends _$OfflineDatabase {
  OfflineDatabase([QueryExecutor? executor]) : super(executor ?? driftDatabase(name: 'fitness_league_offline'));

  @override
  int get schemaVersion => 1;
}

class DriftOutboxStore implements OutboxStore {
  DriftOutboxStore(this.db);

  final OfflineDatabase db;

  @override
  Future<void> put(OutboxItem item) => db.into(db.outboxWorkouts).insertOnConflictUpdate(
        OutboxWorkoutsCompanion.insert(
          clientId: item.clientId,
          payload: item.payloadJson,
          status: item.status.name,
          attempts: Value(item.attempts),
          lastError: Value(item.lastError),
          createdAt: item.createdAt,
        ),
      );

  @override
  Future<List<OutboxItem>> all() async {
    final rows = await (db.select(db.outboxWorkouts)..orderBy([(t) => OrderingTerm(expression: t.createdAt)])).get();
    return rows
        .map((r) => OutboxItem(
              clientId: r.clientId,
              payload: jsonDecode(r.payload) as Map<String, dynamic>,
              status: OutboxStatus.values.byName(r.status),
              attempts: r.attempts,
              lastError: r.lastError,
              createdAt: r.createdAt,
            ))
        .toList();
  }

  @override
  Future<void> remove(String clientId) => (db.delete(db.outboxWorkouts)..where((t) => t.clientId.equals(clientId))).go();
}
