import 'package:flutter/material.dart';

/// Pulsing placeholders while a list loads (static when animations are disabled).
class SkeletonList extends StatefulWidget {
  const SkeletonList({super.key, this.count = 6, this.height = 76});
  final int count;
  final double height;

  @override
  State<SkeletonList> createState() => _SkeletonListState();
}

class _SkeletonListState extends State<SkeletonList> with SingleTickerProviderStateMixin {
  late final _c = AnimationController(vsync: this, duration: const Duration(milliseconds: 900));

  @override
  void didChangeDependencies() {
    super.didChangeDependencies();
    if (MediaQuery.of(context).disableAnimations) {
      _c.stop();
    } else if (!_c.isAnimating) {
      _c.repeat(reverse: true);
    }
  }

  @override
  void dispose() {
    _c.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final base = Theme.of(context).colorScheme.surfaceContainerHighest;
    return ListView.separated(
      physics: const NeverScrollableScrollPhysics(),
      padding: const EdgeInsets.all(16),
      itemCount: widget.count,
      separatorBuilder: (_, _) => const SizedBox(height: 10),
      itemBuilder: (_, _) => AnimatedBuilder(
        animation: _c,
        builder: (_, _) => Container(height: widget.height, decoration: BoxDecoration(color: base.withValues(alpha: 0.45 + 0.35 * _c.value), borderRadius: BorderRadius.circular(18))),
      ),
    );
  }
}
