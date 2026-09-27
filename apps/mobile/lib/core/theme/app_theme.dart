import 'package:flutter/cupertino.dart' show CupertinoPageTransitionsBuilder;
import 'package:flutter/material.dart';

/// Visual direction (spec §19.5): sport × competitive gaming × minimal fitness.
/// Dark first (graphite base), one configurable accent, big numbers, no neon overload.
class AppTheme {
  static const _graphite = Color(0xFF0E0F12);
  static const _surfaceDark = Color(0xFF17191E);
  static const _surfaceDarkHigh = Color(0xFF20232A);

  static ThemeData dark(Color accent) => _build(Brightness.dark, accent);

  /// Big athletic numbers (LP, scores, times).
  static TextStyle display(BuildContext context, {double size = 40}) =>
      TextStyle(fontFamily: 'BarlowCondensed', fontWeight: FontWeight.w800, fontSize: size, height: 1, letterSpacing: -0.5, fontFeatures: const [FontFeature.tabularFigures()]);
  static ThemeData light(Color accent) => _build(Brightness.light, accent);

  static ThemeData _build(Brightness brightness, Color accent) {
    final dark = brightness == Brightness.dark;
    final scheme = ColorScheme.fromSeed(seedColor: accent, brightness: brightness).copyWith(
      primary: dark ? accent : Color.alphaBlend(Colors.black.withValues(alpha: 0.45), accent),
      onPrimary: Colors.black,
      surface: dark ? _surfaceDark : const Color(0xFFF6F7F9),
      surfaceContainerHighest: dark ? _surfaceDarkHigh : const Color(0xFFE9EBEF),
    );
    final base = ThemeData(useMaterial3: true, colorScheme: scheme, brightness: brightness, fontFamily: 'Inter');
    return base.copyWith(
      scaffoldBackgroundColor: dark ? _graphite : Colors.white,
      textTheme: base.textTheme.copyWith(
        displayLarge: base.textTheme.displayLarge?.copyWith(fontFamily: 'BarlowCondensed', fontWeight: FontWeight.w800, letterSpacing: -1),
        displaySmall: base.textTheme.displaySmall?.copyWith(fontFamily: 'BarlowCondensed', fontWeight: FontWeight.w800, letterSpacing: -0.5),
        headlineMedium: base.textTheme.headlineMedium?.copyWith(fontFamily: 'BarlowCondensed', fontWeight: FontWeight.w800),
        titleLarge: base.textTheme.titleLarge?.copyWith(fontWeight: FontWeight.w700),
        labelLarge: base.textTheme.labelLarge?.copyWith(fontWeight: FontWeight.w700, letterSpacing: 0.4),
      ),
      cardTheme: CardThemeData(
        color: scheme.surface,
        elevation: 0,
        margin: EdgeInsets.zero,
        shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(20)),
      ),
      filledButtonTheme: FilledButtonThemeData(
        style: FilledButton.styleFrom(
          minimumSize: const Size.fromHeight(56), // touch targets ≥ 48 dp (spec §19.6)
          shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(16)),
          textStyle: const TextStyle(fontWeight: FontWeight.w800, fontSize: 16, letterSpacing: 0.6),
        ),
      ),
      outlinedButtonTheme: OutlinedButtonThemeData(
        style: OutlinedButton.styleFrom(minimumSize: const Size(48, 48), shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(14))),
      ),
      inputDecorationTheme: InputDecorationTheme(
        filled: true,
        fillColor: scheme.surfaceContainerHighest,
        border: OutlineInputBorder(borderRadius: BorderRadius.circular(14), borderSide: BorderSide.none),
      ),
      appBarTheme: AppBarTheme(
        backgroundColor: dark ? _graphite : Colors.white,
        surfaceTintColor: Colors.transparent,
        centerTitle: false,
        titleTextStyle: base.textTheme.titleLarge?.copyWith(fontFamily: 'BarlowCondensed', fontWeight: FontWeight.w800, fontSize: 26, color: scheme.onSurface),
      ),
      chipTheme: ChipThemeData(shape: StadiumBorder(side: BorderSide(color: scheme.outlineVariant)), labelStyle: base.textTheme.labelLarge),
      pageTransitionsTheme: const PageTransitionsTheme(builders: {
        TargetPlatform.android: ZoomPageTransitionsBuilder(),
        TargetPlatform.iOS: CupertinoPageTransitionsBuilder(),
      }),
      navigationBarTheme: NavigationBarThemeData(
        labelBehavior: NavigationDestinationLabelBehavior.onlyShowSelected,
        backgroundColor: dark ? _graphite : Colors.white,
        indicatorColor: accent.withValues(alpha: 0.18),
        labelTextStyle: WidgetStatePropertyAll(base.textTheme.labelSmall?.copyWith(fontWeight: FontWeight.w700)),
      ),
    );
  }
}
