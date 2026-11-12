const { withGradleProperties } = require('expo/config-plugins');

// Ship only phone CPU architectures. The x86 builds exist for PC emulators and roughly
// doubled the APK (each copy carries the ML Kit text recognizer). React Native's Gradle
// plugin turns this property into ndk.abiFilters, which filters every packaged .so.
const PHONE_ARCHITECTURES = 'armeabi-v7a,arm64-v8a';

module.exports = function withAndroidArchitectures(config) {
  // The emulator EAS profile keeps every architecture so the x86_64 emulator can run the build.
  if (process.env.METACARE_ALL_ARCHITECTURES === '1') return config;
  return withGradleProperties(config, result => {
    const properties = result.modResults.filter(item => !(item.type === 'property' && item.key === 'reactNativeArchitectures'));
    properties.push({ type: 'property', key: 'reactNativeArchitectures', value: PHONE_ARCHITECTURES });
    result.modResults = properties;
    return result;
  });
};
