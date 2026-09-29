import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:intl/intl.dart';

import '../../../core/l10n/l10n.dart';
import '../../../core/utils/format.dart';
import '../../../core/widgets/avatar_badge.dart';
import '../../../core/widgets/common.dart';
import '../../../core/widgets/error_text.dart';
import '../data/feed_repository.dart';

const _reactions = [('LIKE', '👍'), ('FIRE', '🔥'), ('STRONG', '💪')];

/// Friends' activity with reactions and comments (docs §3.9). Loads more at the end of the list.
class FeedScreen extends ConsumerStatefulWidget {
  const FeedScreen({super.key});

  @override
  ConsumerState<FeedScreen> createState() => _FeedScreenState();
}

class _FeedScreenState extends ConsumerState<FeedScreen> {
  final List<Map<String, dynamic>> _items = [];
  String? _cursor;
  bool _hasMore = true;
  bool _loading = false;
  Object? _error;

  @override
  void initState() {
    super.initState();
    _load(reset: true);
  }

  Future<void> _load({bool reset = false}) async {
    if (_loading) return;
    setState(() {
      _loading = true;
      _error = null;
    });
    try {
      final page = await ref.read(feedRepositoryProvider).feed(cursor: reset ? null : _cursor);
      final p = (page['page'] as Map).cast<String, dynamic>();
      if (!mounted) return;
      setState(() {
        if (reset) _items.clear();
        _items.addAll((page['data'] as List).cast<Map<String, dynamic>>());
        _cursor = p['nextCursor'] as String?;
        _hasMore = p['hasMore'] == true;
      });
    } catch (e) {
      if (mounted) setState(() => _error = e);
    } finally {
      if (mounted) setState(() => _loading = false);
    }
  }

  Future<void> _react(int index, String type) async {
    final item = _items[index];
    final repo = ref.read(feedRepositoryProvider);
    try {
      final r = item['myReaction'] == type ? await repo.unreact(item['id'] as String) : await repo.react(item['id'] as String, type);
      if (mounted) setState(() => _items[index] = {...item, 'reactions': r['reactions'], 'myReaction': r['myReaction']});
    } catch (e) {
      if (mounted) ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(errorMessage(context, e))));
    }
  }

  Future<void> _openComments(int index) async {
    final id = _items[index]['id'] as String;
    await showModalBottomSheet<void>(context: context, isScrollControlled: true, showDragHandle: true, builder: (_) => CommentsSheet(activityId: id));
    // Refresh the count from the thread the sheet left behind.
    final thread = ref.read(commentsProvider(id)).valueOrNull;
    if (thread != null && mounted) setState(() => _items[index] = {..._items[index], 'comments': (thread['data'] as List).length});
  }

  @override
  Widget build(BuildContext context) {
    final l = context.l10n;
    final Widget body;
    if (_error != null && _items.isEmpty) {
      body = ListView(children: [ErrorView(error: _error!, onRetry: () => _load(reset: true))]);
    } else if (_items.isEmpty && !_loading) {
      body = ListView(children: [EmptyState(icon: Icons.dynamic_feed_outlined, message: l.feedEmpty, actionLabel: l.findAthletes, onAction: () => context.push('/search'))]);
    } else {
      body = ListView.builder(
        padding: const EdgeInsets.fromLTRB(12, 8, 12, 24),
        itemCount: _items.length + (_hasMore ? 1 : 0),
        itemBuilder: (context, i) {
          if (i == _items.length) {
            WidgetsBinding.instance.addPostFrameCallback((_) => _load());
            return const Padding(padding: EdgeInsets.all(16), child: Center(child: CircularProgressIndicator()));
          }
          return FeedCard(item: _items[i], onReact: (t) => _react(i, t), onComments: () => _openComments(i));
        },
      );
    }
    return Scaffold(appBar: AppBar(title: Text(l.feed)), body: RefreshIndicator(onRefresh: () => _load(reset: true), child: body));
  }
}

/// One line describing the activity, in the reader's language.
String activityText(AppLocalizations l, String locale, Map<String, dynamic> item) {
  final d = (item['details'] as Map?)?.cast<String, dynamic>() ?? const {};
  final opponent = (d['opponent'] as Map?)?.cast<String, dynamic>();
  return switch (item['type']) {
    'WORKOUT' => l.feedWorkout(localized((d['sport'] as Map?)?['name'], locale), ((d['durationS'] as num? ?? 0) / 60).round()),
    'PR' => l.feedPr(localized(d['exercise'], locale), d['value'] is num ? formatNumber(d['value'] as num, locale) : '${d['value'] ?? ''}'),
    'BADGE' => l.feedBadge(localized(d['badgeName'], locale)),
    'LEVEL_UP' => l.feedLevelUp('${d['to'] ?? ''}'),
    'BATTLE_WIN' => l.feedBattleWin((opponent?['fullName'] ?? opponent?['username'] ?? '') as String),
    'GYM_WAR_WIN' => l.feedGymWarWin((d['gymName'] ?? '') as String),
    'GOAL_COMPLETED' => l.feedGoalCompleted,
    _ => '',
  };
}

class FeedCard extends StatelessWidget {
  const FeedCard({super.key, required this.item, required this.onReact, required this.onComments});
  final Map<String, dynamic> item;
  final ValueChanged<String> onReact;
  final VoidCallback onComments;

  @override
  Widget build(BuildContext context) {
    final l = context.l10n;
    final t = Theme.of(context);
    final locale = Localizations.localeOf(context).languageCode;
    final user = (item['user'] as Map).cast<String, dynamic>();
    final name = (user['fullName'] ?? user['username'] ?? '') as String;
    final counts = (item['reactions'] as Map).cast<String, dynamic>();
    final when = DateFormat.MMMd(locale).add_Hm().format(DateTime.parse(item['createdAt'] as String).toLocal());
    return Card(
      margin: const EdgeInsets.only(bottom: 10),
      child: Padding(
        padding: const EdgeInsets.fromLTRB(12, 12, 12, 4),
        child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
          Row(children: [
            AvatarBadge(name: name, size: 40),
            const SizedBox(width: 10),
            Expanded(
              child: InkWell(
                onTap: user['username'] == null || item['isMine'] == true ? null : () => context.push('/u/${user['username']}'),
                child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                  Text(name, style: t.textTheme.titleSmall),
                  Text(when, style: t.textTheme.bodySmall?.copyWith(color: t.colorScheme.outline)),
                ]),
              ),
            ),
          ]),
          const SizedBox(height: 10),
          Text(activityText(l, locale, item), style: t.textTheme.bodyLarge),
          const SizedBox(height: 4),
          Row(children: [
            for (final (type, emoji) in _reactions)
              Padding(
                padding: const EdgeInsetsDirectional.only(end: 4),
                child: ChoiceChip(
                  label: Text('$emoji ${counts[type] ?? 0}'),
                  selected: item['myReaction'] == type,
                  onSelected: (_) => onReact(type),
                  visualDensity: VisualDensity.compact,
                ),
              ),
            const Spacer(),
            TextButton.icon(onPressed: onComments, icon: const Icon(Icons.chat_bubble_outline_rounded, size: 18), label: Text('${item['comments']}')),
          ]),
        ]),
      ),
    );
  }
}

class CommentsSheet extends ConsumerStatefulWidget {
  const CommentsSheet({super.key, required this.activityId});
  final String activityId;

  @override
  ConsumerState<CommentsSheet> createState() => _CommentsSheetState();
}

class _CommentsSheetState extends ConsumerState<CommentsSheet> {
  final _text = TextEditingController();
  bool _busy = false;

  @override
  void dispose() {
    _text.dispose();
    super.dispose();
  }

  Future<void> _send() async {
    setState(() => _busy = true);
    try {
      await ref.read(feedRepositoryProvider).comment(widget.activityId, _text.text.trim());
      _text.clear();
      ref.invalidate(commentsProvider(widget.activityId));
    } catch (e) {
      if (mounted) ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(errorMessage(context, e))));
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final l = context.l10n;
    final thread = ref.watch(commentsProvider(widget.activityId));
    String nameOf(Map<String, dynamic> c) => ((c['user'] as Map)['fullName'] ?? (c['user'] as Map)['username'] ?? '') as String;
    return Padding(
      padding: EdgeInsets.only(bottom: MediaQuery.viewInsetsOf(context).bottom),
      child: SizedBox(
        height: MediaQuery.sizeOf(context).height * 0.6,
        child: Column(children: [
          Expanded(
            child: thread.when(
              loading: () => const Center(child: CircularProgressIndicator()),
              error: (e, _) => ErrorView(error: e, onRetry: () => ref.invalidate(commentsProvider(widget.activityId))),
              data: (t) {
                final rows = (t['data'] as List).cast<Map<String, dynamic>>();
                if (rows.isEmpty) return Center(child: Text(l.noComments));
                return ListView(children: [
                  for (final c in rows)
                    ListTile(
                      leading: AvatarBadge(name: nameOf(c), size: 32),
                      title: Text(nameOf(c)),
                      subtitle: Text(c['body'] as String),
                      trailing: c['isMine'] == true
                          ? IconButton(
                              tooltip: l.delete,
                              icon: const Icon(Icons.delete_outline_rounded),
                              onPressed: () async {
                                await ref.read(feedRepositoryProvider).deleteComment(widget.activityId, c['id'] as String);
                                ref.invalidate(commentsProvider(widget.activityId));
                              },
                            )
                          : null,
                    ),
                ]);
              },
            ),
          ),
          SafeArea(
            child: Padding(
              padding: const EdgeInsets.fromLTRB(12, 4, 4, 8),
              child: Row(children: [
                Expanded(child: TextField(controller: _text, maxLength: 500, decoration: InputDecoration(hintText: l.writeComment, counterText: ''), onChanged: (_) => setState(() {}))),
                IconButton(tooltip: l.sendComment, onPressed: _busy || _text.text.trim().isEmpty ? null : _send, icon: const Icon(Icons.send_rounded)),
              ]),
            ),
          ),
        ]),
      ),
    );
  }
}
