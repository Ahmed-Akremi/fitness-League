import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:image_picker/image_picker.dart';

import '../../../core/l10n/l10n.dart';
import '../../../core/providers.dart';
import '../../../core/widgets/common.dart';
import '../../../core/widgets/error_text.dart';

final proofsProvider = FutureProvider.autoDispose.family<Map<String, dynamic>, String>((ref, id) => ref.watch(apiClientProvider).get<Map<String, dynamic>>('/workouts/$id/proofs'));

/// Photos or screenshots backing a workout (docs §3.5): a moderator verifies them, which makes the workout count more.
class ProofsSection extends ConsumerStatefulWidget {
  const ProofsSection({super.key, required this.workoutId});
  final String workoutId;

  @override
  ConsumerState<ProofsSection> createState() => _ProofsSectionState();
}

class _ProofsSectionState extends ConsumerState<ProofsSection> {
  bool _busy = false;

  Future<void> _add() async {
    final l = context.l10n;
    final messenger = ScaffoldMessenger.of(context);
    final file = await ImagePicker().pickImage(source: ImageSource.gallery, maxWidth: 2048, maxHeight: 2048, imageQuality: 90);
    if (file == null) return;
    final bytes = await file.readAsBytes();
    if (bytes.length > 8 * 1024 * 1024) {
      messenger.showSnackBar(SnackBar(content: Text(l.proofTooLarge)));
      return;
    }
    await _run(() => ref.read(apiClientProvider).upload<Map<String, dynamic>>('/workouts/${widget.workoutId}/proofs', bytes: bytes, filename: file.name, post: true));
  }

  Future<void> _run(Future<void> Function() action) async {
    setState(() => _busy = true);
    try {
      await action();
      ref.invalidate(proofsProvider(widget.workoutId));
    } catch (e) {
      if (mounted) ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(errorMessage(context, e))));
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final l = context.l10n;
    final t = Theme.of(context);
    final data = ref.watch(proofsProvider(widget.workoutId)).valueOrNull;
    if (data == null) return const SizedBox.shrink();
    final status = data['status'] as String;
    final proofs = (data['proofs'] as List).cast<Map<String, dynamic>>();
    final (label, color) = switch (status) {
      'VERIFIED' => (l.proofVerified, t.colorScheme.primary),
      'PENDING' => (l.proofPending, t.colorScheme.outline),
      'REJECTED' => (l.proofRejected, t.colorScheme.error),
      _ => (l.proofNone, t.colorScheme.outline),
    };
    return StatCard(
      label: l.proofs,
      trailing: Text(label, style: t.textTheme.labelLarge?.copyWith(color: color)),
      child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
        if (status == 'REJECTED' && data['note'] != null) Padding(padding: const EdgeInsets.only(bottom: 8), child: Text(data['note'] as String, style: TextStyle(color: t.colorScheme.error))),
        if (proofs.isNotEmpty)
          SizedBox(
            height: 96,
            child: ListView(scrollDirection: Axis.horizontal, children: [
              for (final p in proofs)
                Padding(
                  padding: const EdgeInsetsDirectional.only(end: 8),
                  child: Stack(children: [
                    ClipRRect(borderRadius: BorderRadius.circular(8), child: Image.network(p['url'] as String, width: 96, height: 96, fit: BoxFit.cover, errorBuilder: (_, _, _) => const SizedBox.square(dimension: 96, child: Icon(Icons.broken_image_outlined)))),
                    if (status != 'VERIFIED')
                      PositionedDirectional(
                        top: 0,
                        end: 0,
                        child: IconButton(
                          tooltip: l.delete,
                          icon: const Icon(Icons.close_rounded, size: 18),
                          onPressed: _busy ? null : () => _run(() => ref.read(apiClientProvider).delete<dynamic>('/workouts/${widget.workoutId}/proofs/${p['id']}')),
                        ),
                      ),
                  ]),
                ),
            ]),
          ),
        if (status == 'NONE') Text(l.proofHint, style: t.textTheme.bodySmall?.copyWith(color: t.colorScheme.outline)),
        if (proofs.length < 3 && status != 'VERIFIED')
          Align(alignment: AlignmentDirectional.centerStart, child: TextButton.icon(onPressed: _busy ? null : _add, icon: const Icon(Icons.add_a_photo_outlined), label: Text(l.addProof))),
      ]),
    );
  }
}
