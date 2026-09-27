import 'package:flutter/material.dart';

Color divisionColor(String? code) => switch (code) {
      'SILVER' => const Color(0xFFC0C4CC),
      'GOLD' => const Color(0xFFFFD166),
      'PLATINUM' => const Color(0xFF7FDBDA),
      'DIAMOND' => const Color(0xFF3DA9FC),
      'ELITE' => const Color(0xFFC6F432),
      _ => const Color(0xFFE09F6B), // BRONZE / none
    };

/// Initials avatar ringed with the division colour.
class AvatarBadge extends StatelessWidget {
  const AvatarBadge({super.key, required this.name, this.division, this.size = 44});
  final String name;
  final String? division;
  final double size;

  @override
  Widget build(BuildContext context) {
    final initials = name.split(RegExp(r'\s+')).where((w) => w.isNotEmpty).take(2).map((w) => w.characters.first.toUpperCase()).join();
    return Container(
      width: size,
      height: size,
      padding: const EdgeInsets.all(2.5),
      decoration: BoxDecoration(shape: BoxShape.circle, border: Border.all(color: divisionColor(division), width: 2.5)),
      child: CircleAvatar(
        backgroundColor: Theme.of(context).colorScheme.surfaceContainerHighest,
        child: Text(initials, style: TextStyle(fontWeight: FontWeight.w800, fontSize: size * 0.32)),
      ),
    );
  }
}
