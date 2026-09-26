import 'package:flutter/material.dart';
import 'package:flutter_localizations/flutter_localizations.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import 'core/l10n/l10n.dart';
import 'core/providers.dart';
import 'core/theme/app_theme.dart';
import 'router.dart';

class FitnessLeagueApp extends ConsumerWidget {
  const FitnessLeagueApp({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final config = ref.watch(appConfigProvider);
    final accent = Color(config.accentColor);
    return MaterialApp.router(
      title: config.appName,
      debugShowCheckedModeBanner: false,
      routerConfig: ref.watch(routerProvider),
      theme: AppTheme.light(accent),
      darkTheme: AppTheme.dark(accent),
      themeMode: ref.watch(themeModeProvider),
      // French, English, Arabic from day one; Arabic lays out right-to-left automatically (spec §19.6).
      locale: ref.watch(localeProvider),
      supportedLocales: AppLocalizations.supportedLocales,
      localizationsDelegates: const [
        AppLocalizations.delegate,
        GlobalMaterialLocalizations.delegate,
        GlobalWidgetsLocalizations.delegate,
        GlobalCupertinoLocalizations.delegate,
      ],
      localeResolutionCallback: (device, supported) =>
          supported.firstWhere((l) => l.languageCode == device?.languageCode, orElse: () => const Locale('fr')),
    );
  }
}
