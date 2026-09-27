import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';

import '../../../core/l10n/l10n.dart';
import '../../../core/widgets/avatar_badge.dart';

/// Athlete summary row (id, username, fullName, governorate, level).
class AthleteTile extends StatelessWidget {
  const AthleteTile({super.key, required this.athlete, this.trailing});
  final Map<String, dynamic> athlete;
  final Widget? trailing;

  @override
  Widget build(BuildContext context) {
    final l = context.l10n;
    final name = (athlete['fullName'] ?? athlete['username']) as String;
    return ListTile(
      leading: AvatarBadge(name: name, size: 42),
      title: Text(name),
      subtitle: Text('@${athlete['username']} · ${l.gymLevel} ${athlete['level'] ?? 1}'),
      trailing: trailing,
      onTap: () => context.push('/u/${athlete['username']}'),
    );
  }
}
