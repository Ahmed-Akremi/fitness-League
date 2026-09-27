import 'package:flutter/material.dart';
import 'package:flutter/services.dart';

import '../l10n/l10n.dart';
import '../utils/format.dart';

/// Duration input in m:ss or h:mm:ss. Reports seconds, or null while the text is invalid.
class TimeField extends StatefulWidget {
  const TimeField({super.key, required this.onChanged, this.label, this.initialSeconds, this.controller});
  final ValueChanged<int?> onChanged;
  final String? label;
  final int? initialSeconds;

  /// Optional external controller (e.g. a computed total the user may still edit).
  final TextEditingController? controller;

  @override
  State<TimeField> createState() => _TimeFieldState();
}

class _TimeFieldState extends State<TimeField> {
  late final TextEditingController _c = widget.controller ?? TextEditingController(text: widget.initialSeconds == null ? '' : formatDuration(widget.initialSeconds!));
  bool _invalid = false;

  @override
  void dispose() {
    if (widget.controller == null) _c.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return TextField(
      controller: _c,
      keyboardType: TextInputType.datetime,
      inputFormatters: [FilteringTextInputFormatter.allow(RegExp(r'[0-9:]')), LengthLimitingTextInputFormatter(8)],
      style: const TextStyle(fontFamily: 'BarlowCondensed', fontWeight: FontWeight.w800, fontSize: 22, fontFeatures: [FontFeature.tabularFigures()]),
      decoration: InputDecoration(labelText: widget.label, hintText: '0:00', errorText: _invalid ? context.l10n.timeFormatError : null, prefixIcon: const Icon(Icons.timer_outlined)),
      onChanged: (text) {
        final v = parseDuration(text);
        setState(() => _invalid = text.trim().isNotEmpty && v == null);
        widget.onChanged(v);
      },
    );
  }
}
