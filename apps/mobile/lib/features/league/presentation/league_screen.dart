import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../core/l10n/l10n.dart';
import '../../../core/utils/format.dart';
import '../../../core/widgets/common.dart';
import '../../../core/widgets/error_text.dart';
import '../../home/data/me_repository.dart';
import '../data/league_repository.dart';

/// League tabs (spec §19.2): Tunisia · Region · Gym · Friends. Cursor pagination + jump to my rank.
class LeagueScreen extends ConsumerWidget {
  const LeagueScreen({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final l = context.l10n;
    final me = ref.watch(meProvider).valueOrNull;
    final profile = me?['profile'] as Map<String, dynamic>?;
    final governorateId = (profile?['governorate'] as Map?)?['id'] as String?;
    final gymId = (profile?['gym'] as Map?)?['id'] as String?;
    return DefaultTabController(
      length: 4,
      child: Scaffold(
        appBar: AppBar(
          title: Text(l.navLeague),
          bottom: TabBar(tabs: [Tab(text: l.leagueGlobal), Tab(text: l.leagueRegion), Tab(text: l.leagueGym), Tab(text: l.leagueFriends)]),
        ),
        body: TabBarView(children: [
          LeaderboardList(scope: LeagueScope.national, myId: me?['id'] as String?),
          if (governorateId != null) LeaderboardList(scope: LeagueScope.region, governorateId: governorateId, myId: me?['id'] as String?) else const SizedBox.shrink(),
          if (gymId != null) LeaderboardList(scope: LeagueScope.gym, gymId: gymId, myId: me?['id'] as String?) else EmptyState(icon: Icons.fitness_center_rounded, message: l.noGym),
          LeaderboardList(scope: LeagueScope.friends, myId: me?['id'] as String?),
        ]),
      ),
    );
  }
}

class LeaderboardList extends ConsumerStatefulWidget {
  const LeaderboardList({super.key, required this.scope, this.governorateId, this.gymId, this.myId});
  final LeagueScope scope;
  final String? governorateId;
  final String? gymId;
  final String? myId;

  @override
  ConsumerState<LeaderboardList> createState() => _LeaderboardListState();
}

class _LeaderboardListState extends ConsumerState<LeaderboardList> with AutomaticKeepAliveClientMixin {
  final List<Map<String, dynamic>> _rows = [];
  String? _cursor;
  bool _hasMore = true;
  bool _loading = false;
  Object? _error;

  @override
  bool get wantKeepAlive => true;

  @override
  void initState() {
    super.initState();
    _load(reset: true);
  }

  Future<void> _load({bool reset = false, bool aroundMe = false}) async {
    if (_loading) return;
    setState(() {
      _loading = true;
      _error = null;
    });
    final repo = ref.read(leagueRepositoryProvider);
    try {
      final page = aroundMe
          ? await repo.aroundMe(widget.scope, governorateId: widget.governorateId, gymId: widget.gymId)
          : await repo.page(widget.scope, governorateId: widget.governorateId, gymId: widget.gymId, cursor: reset ? null : _cursor);
      setState(() {
        if (reset || aroundMe) _rows.clear();
        _rows.addAll((page['data'] as List).cast<Map<String, dynamic>>());
        _cursor = (page['page'] as Map)['nextCursor'] as String?;
        _hasMore = (page['page'] as Map)['hasMore'] == true;
      });
    } catch (e) {
      setState(() => _error = e);
    } finally {
      if (mounted) setState(() => _loading = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    super.build(context);
    final l = context.l10n;
    final t = Theme.of(context);
    final locale = Localizations.localeOf(context).languageCode;
    if (_error != null && _rows.isEmpty) return ErrorView(error: _error!, onRetry: () => _load(reset: true));
    if (_rows.isEmpty && _loading) return const Center(child: CircularProgressIndicator());
    if (_rows.isEmpty) return EmptyState(icon: Icons.emoji_events_rounded, message: widget.scope == LeagueScope.friends ? l.emptyFriends : l.emptyLeague);
    return Stack(children: [
      NotificationListener<ScrollNotification>(
        onNotification: (n) {
          if (n.metrics.extentAfter < 300 && _hasMore && !_loading) _load();
          return false;
        },
        child: RefreshIndicator(
          onRefresh: () => _load(reset: true),
          child: ListView.builder(
            padding: const EdgeInsets.fromLTRB(12, 8, 12, 88),
            itemCount: _rows.length,
            itemBuilder: (_, i) {
              final r = _rows[i];
              final athlete = r['athlete'] as Map<String, dynamic>;
              final mine = athlete['id'] == widget.myId;
              return Card(
                key: Key('rank-${athlete['id']}'),
                color: mine ? t.colorScheme.primary.withValues(alpha: 0.14) : null,
                margin: const EdgeInsets.only(bottom: 8),
                child: ListTile(
                  leading: SizedBox(width: 44, child: Text('#${r['rank']}', style: t.textTheme.titleMedium?.copyWith(fontWeight: FontWeight.w800))),
                  title: Text(athlete['fullName'] as String, maxLines: 1, overflow: TextOverflow.ellipsis),
                  subtitle: Text([
                    if (r['gym'] != null) (r['gym'] as Map)['name'],
                    localized((r['governorate'] as Map)['name'], locale),
                    l.level(r['level'] as int),
                  ].join(' · ')),
                  trailing: Column(mainAxisAlignment: MainAxisAlignment.center, crossAxisAlignment: CrossAxisAlignment.end, children: [
                    Text('${formatNumber(r['lp'] as num, locale)} LP', style: t.textTheme.titleSmall?.copyWith(fontWeight: FontWeight.w800)),
                    if (r['movement'] != null) MovementBadge(movement: r['movement'], newLabel: l.movementNew),
                  ]),
                ),
              );
            },
          ),
        ),
      ),
      if (widget.myId != null)
        PositionedDirectional(
          end: 16,
          bottom: 16,
          child: FloatingActionButton.small(heroTag: 'jump-${widget.scope.name}', tooltip: l.jumpToMe, onPressed: () => _load(aroundMe: true), child: const Icon(Icons.my_location_rounded)),
        ),
    ]);
  }
}
