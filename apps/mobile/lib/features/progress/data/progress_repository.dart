import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../core/providers.dart';

final progressProvider = FutureProvider.autoDispose.family<Map<String, dynamic>, String>(
  (ref, period) => ref.watch(apiClientProvider).get<Map<String, dynamic>>('/me/progress', query: {'period': period}),
);

final seriesProvider = FutureProvider.autoDispose.family<Map<String, dynamic>, (String, String, String)>(
  (ref, k) => ref.watch(apiClientProvider).get<Map<String, dynamic>>('/me/progress/metrics/${k.$1}/${k.$2}', query: {'period': k.$3}),
);

final recordsProvider = FutureProvider.autoDispose<List<Map<String, dynamic>>>(
  (ref) async => (await ref.watch(apiClientProvider).get<List<dynamic>>('/me/records')).cast<Map<String, dynamic>>(),
);
