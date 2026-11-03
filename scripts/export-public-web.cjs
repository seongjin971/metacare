const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { configuredCareEndpoint } = require('../shared/care-endpoint.ts');

const root = path.resolve(__dirname, '..');
const output = path.join(root, '.preview', 'public-web');
const apiUrl = configuredCareEndpoint(
  process.env.EXPO_PUBLIC_CARE_URL || 'https://metacare-sharing-test.vercel.app', false,
);
const stages = ['patient', 'caregiver'].map(name => path.join(output, name));
const buildOutput = {
  version: 3,
  routes: [
    { handle: 'filesystem' },
    { src: '^/(?:[^./]+/)*[^./]*$', dest: '/index.html' },
  ],
};

// Keep each origin so existing device pairings continue to work.
// Both hosts serve exactly the same application and use the same router.
const [primary] = stages;
const primaryStatic = path.join(primary, '.vercel', 'output', 'static');
execFileSync(process.execPath, [
  require.resolve('expo/bin/cli', { paths: [root] }), 'export', '--platform', 'web', '--output-dir', primaryStatic,
], {
  cwd: root,
  env: { ...process.env, NODE_ENV: 'production', EXPO_NO_DOTENV: '1', EXPO_PUBLIC_CARE_URL: apiUrl },
  stdio: 'inherit',
});
const index = path.join(primaryStatic, 'index.html');
fs.accessSync(path.join(primaryStatic, 'care-alert-worker.js'), fs.constants.R_OK);
fs.writeFileSync(index, fs.readFileSync(index, 'utf8').replace('lang="en"', 'lang="ko"').replace('</head>',
  '<link rel="manifest" href="/manifest.webmanifest"><link rel="apple-touch-icon" href="/care-icon-192.png"><meta name="theme-color" content="#3066e9"></head>'));
for (const stage of stages) {
  const build = path.join(stage, '.vercel', 'output');
  // A prebuilt upload sends only this build output. Keep Vercel's project link outside it.
  const dest = path.join(build, 'static');
  fs.mkdirSync(build, { recursive: true });
  fs.writeFileSync(path.join(stage, '.vercelignore'), '/*\n');
  if (dest !== primaryStatic) {
    // Replace only this generated output, so superseded chunks never ship on an alias.
    const expected = path.resolve(output, 'caregiver', '.vercel', 'output', 'static');
    if (path.resolve(dest) !== expected || fs.existsSync(dest) && fs.realpathSync.native(dest) !== expected)
      throw new Error('Unexpected web export directory.');
    fs.rmSync(dest, { recursive: true, force: true });
    fs.cpSync(primaryStatic, dest, { recursive: true });
  }
  fs.writeFileSync(path.join(build, 'config.json'), JSON.stringify(buildOutput, null, 2) + '\n');
}
