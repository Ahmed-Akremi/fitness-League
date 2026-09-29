import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../../core/l10n/l10n.dart';
import '../../../core/widgets/error_text.dart';
import '../../../core/widgets/section_header.dart';
import '../data/leagues_repository.dart';
import 'leagues_tab.dart';

/// Create a league: name, private or public, what counts, how long.
class NewLeagueScreen extends ConsumerStatefulWidget {
  const NewLeagueScreen({super.key});

  @override
  ConsumerState<NewLeagueScreen> createState() => _NewLeagueScreenState();
}

class _NewLeagueScreenState extends ConsumerState<NewLeagueScreen> {
  final _name = TextEditingController();
  bool _public = false;
  String _preset = 'STANDARD';
  int _weeks = 8;
  bool _busy = false;
  Object? _error;

  @override
  void dispose() {
    _name.dispose();
    super.dispose();
  }

  Future<void> _create() async {
    setState(() {
      _busy = true;
      _error = null;
    });
    try {
      final lg = await ref.read(leaguesRepositoryProvider).create({
        'name': _name.text.trim(),
        'visibility': _public ? 'PUBLIC' : 'PRIVATE',
        'scoringPreset': _preset,
        'endsAt': DateTime.now().toUtc().add(Duration(days: 7 * _weeks)).toIso8601String(),
      });
      ref.invalidate(leaguesProvider);
      if (mounted && GoRouter.maybeOf(context) != null) context.replace('/leagues/${lg['id']}');
    } catch (e) {
      if (mounted) setState(() => _error = e);
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final l = context.l10n;
    final t = Theme.of(context);
    return Scaffold(
      appBar: AppBar(title: Text(l.newLeague)),
      bottomNavigationBar: SafeArea(
        child: Padding(
          padding: const EdgeInsets.fromLTRB(16, 8, 16, 12),
          child: FilledButton(
            onPressed: _busy || _name.text.trim().length < 3 ? null : _create,
            child: _busy ? const SizedBox.square(dimension: 22, child: CircularProgressIndicator(strokeWidth: 2)) : Text(l.createLeague),
          ),
        ),
      ),
      body: ListView(padding: const EdgeInsets.all(16), children: [
        TextField(controller: _name, maxLength: 60, decoration: InputDecoration(labelText: l.leagueName), onChanged: (_) => setState(() {})),
        SwitchListTile(contentPadding: EdgeInsets.zero, title: Text(l.leaguePublic), subtitle: Text(l.leaguePublicHint), value: _public, onChanged: (v) => setState(() => _public = v)),
        SectionHeader(title: l.leagueRanking),
        SegmentedButton<String>(
          segments: [for (final p in const ['STANDARD', 'CONSISTENCY', 'PROGRESS']) ButtonSegment(value: p, label: Text(leaguePresetLabel(l, p)))],
          selected: {_preset},
          onSelectionChanged: (s) => setState(() => _preset = s.first),
        ),
        SectionHeader(title: l.battleDuration),
        SegmentedButton<int>(
          segments: [for (final w in const [4, 8, 12]) ButtonSegment(value: w, label: Text(l.weeksCount(w)))],
          selected: {_weeks},
          onSelectionChanged: (s) => setState(() => _weeks = s.first),
        ),
        if (_error != null) Padding(padding: const EdgeInsets.only(top: 12), child: Text(errorMessage(context, _error!), style: TextStyle(color: t.colorScheme.error))),
      ]),
    );
  }
}
