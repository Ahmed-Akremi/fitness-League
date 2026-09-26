import 'package:uuid/uuid.dart';

/// Client-generated workout ids double as idempotency keys (docs §10).
String newClientId() => const Uuid().v4();
