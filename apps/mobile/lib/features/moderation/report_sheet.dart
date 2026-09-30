import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../core/l10n/l10n.dart';
import '../../core/providers.dart';
import '../../core/widgets/error_text.dart';

const _reasons = ['CHEATING', 'HARASSMENT', 'SPAM', 'INAPPROPRIATE', 'IMPERSONATION', 'OTHER'];

String reportReasonLabel(AppLocalizations l, String r) => switch (r) {
      'CHEATING' => l.reportCheating,
      'HARASSMENT' => l.reportHarassment,
      'SPAM' => l.reportSpam,
      'INAPPROPRIATE' => l.reportInappropriate,
      'IMPERSONATION' => l.reportImpersonation,
      _ => l.reportOther,
    };

/// Report an athlete, a workout, a comment or a gym (docs §3.12). Moderators review it; the reporter only
/// learns that it was handled.
Future<void> showReportSheet(BuildContext context, {required String targetType, required String targetId}) =>
    showModalBottomSheet<void>(context: context, isScrollControlled: true, showDragHandle: true, builder: (_) => ReportSheet(targetType: targetType, targetId: targetId));

class ReportSheet extends ConsumerStatefulWidget {
  const ReportSheet({super.key, required this.targetType, required this.targetId});
  final String targetType;
  final String targetId;

  @override
  ConsumerState<ReportSheet> createState() => _ReportSheetState();
}

class _ReportSheetState extends ConsumerState<ReportSheet> {
  String? _reason;
  final _details = TextEditingController();
  bool _busy = false;

  @override
  void dispose() {
    _details.dispose();
    super.dispose();
  }

  Future<void> _send() async {
    final l = context.l10n;
    final messenger = ScaffoldMessenger.of(context);
    final nav = Navigator.of(context);
    setState(() => _busy = true);
    try {
      await ref.read(apiClientProvider).post<dynamic>('/reports', data: {
        'targetType': widget.targetType,
        'targetId': widget.targetId,
        'reason': _reason,
        if (_details.text.trim().isNotEmpty) 'details': _details.text.trim(),
      });
      nav.pop();
      messenger.showSnackBar(SnackBar(content: Text(l.reportSent)));
    } catch (e) {
      if (mounted) messenger.showSnackBar(SnackBar(content: Text(errorMessage(context, e))));
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final l = context.l10n;
    return Padding(
      padding: EdgeInsets.fromLTRB(16, 0, 16, 16 + MediaQuery.viewInsetsOf(context).bottom),
      child: SingleChildScrollView(
        child: Column(mainAxisSize: MainAxisSize.min, crossAxisAlignment: CrossAxisAlignment.stretch, children: [
          Text(l.report, style: Theme.of(context).textTheme.titleLarge),
          const SizedBox(height: 8),
          RadioGroup<String>(
            groupValue: _reason,
            onChanged: (v) => setState(() => _reason = v),
            child: Column(children: [for (final r in _reasons) RadioListTile<String>(value: r, title: Text(reportReasonLabel(l, r)))]),
          ),
          TextField(controller: _details, maxLength: 1000, maxLines: 3, decoration: InputDecoration(labelText: l.reportDetails)),
          const SizedBox(height: 8),
          FilledButton(onPressed: _busy || _reason == null ? null : _send, child: Text(l.reportSend)),
        ]),
      ),
    );
  }
}
