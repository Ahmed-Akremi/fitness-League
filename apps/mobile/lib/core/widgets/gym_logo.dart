import 'package:cached_network_image/cached_network_image.dart';
import 'package:flutter/material.dart';

/// Gym logo (rounded square). Without a URL, initials on a colour derived from the name.
class GymLogo extends StatelessWidget {
  const GymLogo({super.key, required this.name, this.url, this.size = 56});
  final String name;
  final String? url;
  final double size;

  static const _palette = [Color(0xFFC6F432), Color(0xFF3DA9FC), Color(0xFFFF8A3D), Color(0xFFF15BB5), Color(0xFF06D6A0), Color(0xFFFFD166), Color(0xFF9B5DE5)];

  String get _initials => name.split(RegExp(r'\s+')).where((w) => w.isNotEmpty && RegExp(r'^\p{L}', unicode: true).hasMatch(w)).take(2).map((w) => w.characters.first.toUpperCase()).join();

  @override
  Widget build(BuildContext context) {
    final radius = BorderRadius.circular(size * 0.24);
    final bg = _palette[name.codeUnits.fold<int>(0, (a, b) => a + b) % _palette.length];
    final fallback = Container(
      width: size,
      height: size,
      alignment: Alignment.center,
      decoration: BoxDecoration(color: bg, borderRadius: radius),
      child: Text(_initials, style: TextStyle(fontFamily: 'BarlowCondensed', fontWeight: FontWeight.w800, fontSize: size * 0.4, color: const Color(0xFF0E0F12))),
    );
    return Semantics(
      label: name,
      image: true,
      child: url == null
          ? fallback
          : ClipRRect(
              borderRadius: radius,
              child: CachedNetworkImage(imageUrl: url!, width: size, height: size, fit: BoxFit.cover, placeholder: (_, _) => fallback, errorWidget: (_, _, _) => fallback),
            ),
    );
  }
}
