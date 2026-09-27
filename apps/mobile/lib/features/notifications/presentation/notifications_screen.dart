import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:intl/intl.dart';

import '../../../core/l10n/l10n.dart';
import '../../../core/widgets/common.dart';
import '../../../core/widgets/error_text.dart';
import '../data/notifications_repository.dart';

/// In-app notifications: unread first highlighted, tap opens the related screen.
class NotificationsScreen extends ConsumerStatefulWidget {
  const NotificationsScreen({super.key});

  @override
  ConsumerState<NotificationsScreen> createState() => _NotificationsScreenState();
}

class _NotificationsScreenState extends ConsumerState<NotificationsScreen> {
  late Future<Map<String, dynamic>> _page;

  NotificationsRepository get _repo => ref.read(notificationsRepositoryProvider);

  @override
  void initState() {
    super.initState();
    _page = _repo.list();
  }

  void _reload() {
    ref.invalidate(unreadCountProvider);
    final next = _repo.list();
    setState(() {
      _page = next;
    });
  }

  Future<void> _open(Map<String, dynamic> n) async {
    if (n['read'] != true) await _repo.markRead([n['id'] as String]);
    final route = notificationRoute(n);
    if (!mounted) return;
    if (route != null && GoRouter.maybeOf(context) != null) await context.push(route);
    _reload();
  }

  @override
  Widget build(BuildContext context) {
    final l = context.l10n;
    final t = Theme.of(context);
    final locale = Localizations.localeOf(context).toLanguageTag();
    return Scaffold(
      appBar: AppBar(title: Text(l.notifications), actions: [
        IconButton(
          tooltip: l.markAllRead,
          icon: const Icon(Icons.done_all_rounded),
          onPressed: () async {
            await _repo.markRead();
            _reload();
          },
        ),
      ]),
      body: FutureBuilder<Map<String, dynamic>>(
        future: _page,
        builder: (context, snap) => AsyncBody<Map<String, dynamic>>(
          snapshot: snap,
          error: (e, _) => ErrorView(error: e, onRetry: _reload),
          builder: (page) {
            final rows = (page['data'] as List).cast<Map<String, dynamic>>();
            if (rows.isEmpty) return EmptyState(icon: Icons.notifications_off_outlined, message: l.noNotifications);
            return RefreshIndicator(
              onRefresh: () async => _reload(),
              child: ListView.separated(
                padding: const EdgeInsets.symmetric(vertical: 8),
                itemCount: rows.length,
                separatorBuilder: (_, _) => const Divider(height: 1, indent: 72),
                itemBuilder: (_, i) {
                  final n = rows[i];
                  final unread = n['read'] != true;
                  return ListTile(
                    leading: CircleAvatar(
                      backgroundColor: (unread ? t.colorScheme.primary : t.colorScheme.outline).withValues(alpha: 0.16),
                      child: Icon(notificationIcon(n['type'] as String?), color: unread ? t.colorScheme.primary : t.colorScheme.outline),
                    ),
                    title: Text(notificationText(l, n), style: TextStyle(fontWeight: unread ? FontWeight.w700 : FontWeight.w400)),
                    subtitle: Text(DateFormat.MMMd(locale).add_Hm().format(DateTime.parse(n['createdAt'] as String).toLocal())),
                    trailing: unread ? Icon(Icons.circle, size: 10, color: t.colorScheme.primary) : null,
                    onTap: () => _open(n),
                  );
                },
              ),
            );
          },
        ),
      ),
    );
  }
}
