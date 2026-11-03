const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { configuredCareEndpoint } = require('../shared/care-endpoint.ts');

const root = path.resolve(__dirname, '..');
const output = path.join(root, '.preview', 'public-web');
const apiUrl = configuredCareEndpoint(
  process.env.EXPO_PUBLIC_CARE_URL || 'https://metacare-sharing-test.vercel.app', false,
);
const apps = { patient: root, caregiver: path.join(root, 'caregiver') };
const buildOutput = {
  version: 3,
  routes: [
    { handle: 'filesystem' },
    { src: '^/(?:[^./]+/)*[^./]*$', dest: '/index.html' },
  ],
};

for (const [name, project] of Object.entries(apps)) {
  const stage = path.join(output, name);
  const build = path.join(stage, '.vercel', 'output');
  // A prebuilt upload sends only this build output. Keep Vercel's project link outside it.
  const dest = path.join(build, 'static');
  fs.mkdirSync(build, { recursive: true });
  fs.writeFileSync(path.join(stage, '.vercelignore'), '/*\n');
  execFileSync(process.execPath, [
    require.resolve('expo/bin/cli', { paths: [project] }), 'export', '--platform', 'web', '--output-dir', dest,
  ], {
    cwd: project,
    env: { ...process.env, NODE_ENV: 'production', EXPO_NO_DOTENV: '1', EXPO_PUBLIC_CARE_URL: apiUrl },
    stdio: 'inherit',
  });
  fs.accessSync(path.join(dest, 'index.html'), fs.constants.R_OK);
  fs.writeFileSync(path.join(build, 'config.json'), JSON.stringify(buildOutput, null, 2) + '\n');
}
