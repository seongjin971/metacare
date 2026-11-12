const { withAppBuildGradle } = require('expo/config-plugins');

// Local release builds sign with the EAS keystore when credentials.json (downloaded with
// `eas credentials`, git-ignored) is present, so a locally built APK installs over an EAS one.
// EAS cloud builds never see that file and keep using their own remote signing.
const MARKER = '// metacare-local-release-signing';
const BLOCK = `
${MARKER}
def metacareCredentials = rootProject.file('../credentials.json')
if (metacareCredentials.exists()) {
    def keystore = new groovy.json.JsonSlurper().parse(metacareCredentials).android.keystore
    android.signingConfigs.create('metacareRelease') {
        storeFile rootProject.file("../\${keystore.keystorePath}")
        storePassword keystore.keystorePassword
        keyAlias keystore.keyAlias
        keyPassword keystore.keyPassword
    }
    android.buildTypes.release.signingConfig android.signingConfigs.metacareRelease
}
`;

module.exports = function withLocalReleaseSigning(config) {
  return withAppBuildGradle(config, result => {
    if (result.modResults.language === 'groovy' && !result.modResults.contents.includes(MARKER)) {
      result.modResults.contents += BLOCK;
    }
    return result;
  });
};
