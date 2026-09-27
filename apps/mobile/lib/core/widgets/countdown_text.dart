import 'dart:async';

import 'package:flutter/material.dart';

import '../l10n/l10n.dart';

/// "2d 4h left" / "3h 12m left" / "8m left"; refreshes every 30 s.
class CountdownText extends StatefulWidget {
  const CountdownText({super.key, required this.endsAt, this.style});
  final DateTime endsAt;
  final TextStyle? style;

  @override
  State<CountdownText> createState() => _CountdownTextState();
}

class _CountdownTextState extends State<CountdownText> {
  Timer? _timer;

  @override
  void initState() {
    super.initState();
    _timer = Timer.periodic(const Duration(seconds: 30), (_) => setState(() {}));
  }

  @override
  void dispose() {
    _timer?.cancel();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final l = context.l10n;
    final left = widget.endsAt.difference(DateTime.now());
    final text = left.isNegative
        ? l.wodEnded
        : left.inDays > 0
            ? l.timeLeftDays(left.inDays, left.inHours % 24)
            : left.inHours > 0
                ? l.timeLeftHours(left.inHours, left.inMinutes % 60)
                : l.timeLeftMinutes(left.inMinutes.clamp(1, 59));
    return Text(text, style: widget.style);
  }
}
