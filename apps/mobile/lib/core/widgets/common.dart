import 'package:flutter/material.dart';

/// Athletic card: big number, small label.
class StatCard extends StatelessWidget {
  const StatCard({super.key, required this.label, required this.child, this.onTap, this.trailing});

  final String label;
  final Widget child;
  final VoidCallback? onTap;
  final Widget? trailing;

  @override
  Widget build(BuildContext context) {
    final t = Theme.of(context);
    return Card(
      clipBehavior: Clip.antiAlias,
      child: InkWell(
        onTap: onTap,
        child: Padding(
          padding: const EdgeInsets.all(18),
          child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
            Row(children: [
              Expanded(child: Text(label.toUpperCase(), style: t.textTheme.labelMedium?.copyWith(color: t.colorScheme.outline, letterSpacing: 1.2, fontWeight: FontWeight.w700))),
              ?trailing,
            ]),
            const SizedBox(height: 10),
            child,
          ]),
        ),
      ),
    );
  }
}

/// Animated XP bar. Animations are skipped when the OS asks for reduced motion (spec §19.6).
class XpBar extends StatelessWidget {
  const XpBar({super.key, required this.value, this.semanticsLabel});

  final double value;
  final String? semanticsLabel;

  @override
  Widget build(BuildContext context) {
    final reduced = MediaQuery.of(context).disableAnimations;
    final color = Theme.of(context).colorScheme.primary;
    final bar = LinearProgressIndicator(
      value: value.clamp(0, 1),
      minHeight: 10,
      borderRadius: BorderRadius.circular(8),
      color: color,
      backgroundColor: color.withValues(alpha: 0.15),
    );
    return Semantics(
      label: semanticsLabel,
      value: '${(value * 100).round()}%',
      child: reduced
          ? bar
          : TweenAnimationBuilder<double>(
              tween: Tween(begin: 0, end: value.clamp(0, 1)),
              duration: const Duration(milliseconds: 900),
              curve: Curves.easeOutCubic,
              builder: (_, v, _) => LinearProgressIndicator(
                value: v,
                minHeight: 10,
                borderRadius: BorderRadius.circular(8),
                color: color,
                backgroundColor: color.withValues(alpha: 0.15),
              ),
            ),
    );
  }
}

class EmptyState extends StatelessWidget {
  const EmptyState({super.key, required this.icon, required this.message, this.actionLabel, this.onAction});

  final IconData icon;
  final String message;
  final String? actionLabel;
  final VoidCallback? onAction;

  @override
  Widget build(BuildContext context) {
    final t = Theme.of(context);
    return Center(
      child: Padding(
        padding: const EdgeInsets.all(32),
        child: Column(mainAxisSize: MainAxisSize.min, children: [
          Icon(icon, size: 56, color: t.colorScheme.primary),
          const SizedBox(height: 16),
          Text(message, textAlign: TextAlign.center, style: t.textTheme.titleMedium),
          if (actionLabel != null) ...[
            const SizedBox(height: 20),
            FilledButton(onPressed: onAction, child: Text(actionLabel!)),
          ],
        ]),
      ),
    );
  }
}

/// Loading / error / data for an AsyncValue-like future.
class AsyncBody<T> extends StatelessWidget {
  const AsyncBody({super.key, required this.snapshot, required this.builder, required this.error, this.onRetry});

  final AsyncSnapshot<T> snapshot;
  final Widget Function(T data) builder;
  final Widget Function(Object error, VoidCallback? retry) error;
  final VoidCallback? onRetry;

  @override
  Widget build(BuildContext context) {
    if (snapshot.hasError) return error(snapshot.error!, onRetry);
    if (!snapshot.hasData) return const Center(child: CircularProgressIndicator());
    return builder(snapshot.data as T);
  }
}

/// Movement arrow for leaderboard rows: ↑4, ↓2, NEW.
class MovementBadge extends StatelessWidget {
  const MovementBadge({super.key, required this.movement, required this.newLabel});

  final Object? movement;
  final String newLabel;

  @override
  Widget build(BuildContext context) {
    final t = Theme.of(context);
    if (movement == 'NEW') return Text(newLabel, style: t.textTheme.labelSmall?.copyWith(color: t.colorScheme.primary, fontWeight: FontWeight.w800));
    final m = movement is num ? (movement! as num).toInt() : 0;
    if (m == 0) return Text('–', style: t.textTheme.labelMedium?.copyWith(color: t.colorScheme.outline));
    final up = m > 0;
    return Text('${up ? '↑' : '↓'}${m.abs()}',
        semanticsLabel: '${up ? '+' : '-'}${m.abs()}', style: t.textTheme.labelMedium?.copyWith(color: up ? const Color(0xFF3DDC84) : const Color(0xFFFF6B6B), fontWeight: FontWeight.w800));
  }
}
