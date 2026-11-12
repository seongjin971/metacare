// Build a release APK on this PC instead of EAS.
//   npm run apk:local            phone architectures, the APK to give testers
//   npm run apk:local:emulator   every architecture, for the x86_64 PC emulator
// Needs credentials.json from `npx eas-cli credentials -p android` (preview profile → Download)
// so the APK is signed with the same key as EAS builds and installs over them.
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const root = path.resolve(__dirname, '..');
const emulator = process.argv.includes('--emulator');
const firstExisting = (...candidates) => candidates.find(item => item && fs.existsSync(item));

const eas = JSON.parse(fs.readFileSync(path.join(root, 'eas.json'), 'utf8'));
const app = JSON.parse(fs.readFileSync(path.join(root, 'app.json'), 'utf8')).expo;
const env = {
  ...process.env,
  JAVA_HOME: firstExisting(process.env.JAVA_HOME, 'D:\\Dev\\Tools\\jdk17'),
  ANDROID_HOME: firstExisting(process.env.ANDROID_HOME, 'D:\\Dev\\Tools\\Android'),
  EXPO_PUBLIC_CARE_URL: process.env.EXPO_PUBLIC_CARE_URL || eas.build.preview.env.EXPO_PUBLIC_CARE_URL,
  NODE_ENV: 'production',
  ...(emulator && { METACARE_ALL_ARCHITECTURES: '1' }),
};
if (!env.JAVA_HOME || !env.ANDROID_HOME) fail('JDK 17 또는 Android SDK를 찾지 못했어요. JAVA_HOME과 ANDROID_HOME을 확인해 주세요.');
if (!fs.existsSync(path.join(root, 'credentials.json'))) {
  fail('credentials.json이 없어요. `npx eas-cli credentials -p android`에서 preview → credentials.json 다운로드를 먼저 해 주세요.');
}

function fail(message) { console.error(`\n[오류] ${message}`); process.exit(1); }
function run(command, args, cwd) {
  console.log(`\n> ${command} ${args.join(' ')}`);
  const result = spawnSync(command, args, { cwd, env, stdio: 'inherit', shell: process.platform === 'win32' });
  if (result.status !== 0) fail(`${command} 실행이 실패했어요 (종료 코드 ${result.status}).`);
}

// Prebuild rewrites package.json scripts; keep the repository's own version.
const packagePath = path.join(root, 'package.json');
const packageJson = fs.readFileSync(packagePath, 'utf8');
try {
  // --clean so an architecture change between phone and emulator builds always applies.
  run('npx', ['expo', 'prebuild', '--platform', 'android', '--no-install', '--clean'], root);
} finally {
  fs.writeFileSync(packagePath, packageJson);
}
const androidDir = path.join(root, 'android');
run(`"${path.join(androidDir, process.platform === 'win32' ? 'gradlew.bat' : 'gradlew')}"`, ['assembleRelease', '--console=plain'], androidDir);

const built = path.join(root, 'android', 'app', 'build', 'outputs', 'apk', 'release', 'app-release.apk');
if (!fs.existsSync(built)) fail('APK 파일을 찾지 못했어요.');
const outputDir = path.join(root, '.preview', 'builds');
fs.mkdirSync(outputDir, { recursive: true });
const output = path.join(outputDir, `metacare-${app.version}-${app.android.versionCode}${emulator ? '-emulator' : ''}.apk`);
fs.copyFileSync(built, output);
console.log(`\n완료: ${output} (${(fs.statSync(output).size / 1e6).toFixed(1)}MB)`);
