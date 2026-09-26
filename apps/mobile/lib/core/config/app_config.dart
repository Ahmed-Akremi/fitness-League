/// Build-time configuration (flavors pass these with --dart-define).
/// The app name is configurable (spec §0): rebranding is a build flag, not a code change.
class AppConfig {
  const AppConfig({required this.appName, required this.apiBaseUrl, required this.accentColor});

  factory AppConfig.fromEnvironment() => const AppConfig(
        appName: String.fromEnvironment('APP_NAME', defaultValue: 'Fitness League'),
        // 10.0.2.2 is the host machine seen from the Android emulator.
        apiBaseUrl: String.fromEnvironment('API_BASE_URL', defaultValue: 'http://10.0.2.2:3000/api/v1'),
        accentColor: int.fromEnvironment('ACCENT_COLOR', defaultValue: 0xFFC6F432),
      );

  final String appName;
  final String apiBaseUrl;
  final int accentColor;
}
