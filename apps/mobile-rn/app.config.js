// Extends app.json. Release builds block plain-HTTP traffic on Android; allow it only when the build targets an
// http:// API (local dev, e.g. http://10.0.2.2:3000 from the emulator). Production builds use https and stay locked.
module.exports = ({ config }) => {
  const cleartext = (process.env.EXPO_PUBLIC_API_URL ?? 'http://10.0.2.2:3000/api/v1').startsWith('http://');
  const plugins = (config.plugins ?? []).filter((p) => p !== 'expo-build-properties');
  return {
    ...config,
    plugins: [...plugins, ['expo-build-properties', { android: { usesCleartextTraffic: cleartext } }]],
  };
};
