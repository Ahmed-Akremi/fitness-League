import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../core/l10n/l10n.dart';
import '../../../core/widgets/common.dart';
import '../../../core/widgets/error_text.dart';
import '../data/social_repository.dart';
import 'athlete_tile.dart';

/// Athlete search (≥ 2 characters, debounced).
class SearchScreen extends ConsumerStatefulWidget {
  const SearchScreen({super.key});

  @override
  ConsumerState<SearchScreen> createState() => _SearchScreenState();
}

class _SearchScreenState extends ConsumerState<SearchScreen> {
  Timer? _debounce;
  String _q = '';
  Future<Map<String, dynamic>>? _results;

  @override
  void dispose() {
    _debounce?.cancel();
    super.dispose();
  }

  void _onChanged(String v) {
    _debounce?.cancel();
    _debounce = Timer(const Duration(milliseconds: 350), () {
      final q = v.trim();
      if (q == _q) return;
      setState(() {
        _q = q;
        _results = q.length < 2 ? null : ref.read(socialRepositoryProvider).search(q);
      });
    });
  }

  @override
  Widget build(BuildContext context) {
    final l = context.l10n;
    return Scaffold(
      appBar: AppBar(title: Text(l.findAthletes)),
      body: Column(children: [
        Padding(
          padding: const EdgeInsets.fromLTRB(16, 4, 16, 8),
          child: TextField(autofocus: true, decoration: InputDecoration(prefixIcon: const Icon(Icons.search_rounded), hintText: l.searchAthletesHint), onChanged: _onChanged),
        ),
        Expanded(
          child: _results == null
              ? EmptyState(icon: Icons.person_search_outlined, message: l.searchAthletesHint)
              : FutureBuilder<Map<String, dynamic>>(
                  future: _results,
                  builder: (context, snap) => AsyncBody<Map<String, dynamic>>(
                    snapshot: snap,
                    error: (e, _) => ErrorView(error: e),
                    builder: (page) {
                      final rows = (page['data'] as List).cast<Map<String, dynamic>>();
                      if (rows.isEmpty) return EmptyState(icon: Icons.search_off_rounded, message: l.noAthleteFound);
                      return ListView(children: [for (final a in rows) AthleteTile(athlete: a)]);
                    },
                  ),
                ),
        ),
      ]),
    );
  }
}
