const fs = require('node:fs');
const path = require('node:path');
const net = require('node:net');
const { spawn } = require('node:child_process');
const projectDirectory = path.resolve(__dirname, '..');
const logDirectory = path.join(projectDirectory, '.preview', 'caregiver');
fs.mkdirSync(logDirectory, { recursive: true });

function listening(port) {
  return new Promise(resolve => {
    const socket = net.createConnection({ port, host: '127.0.0.1' });
    let done = false;
    const finish = value => { if (!done) { done = true; socket.destroy(); resolve(value); } };
    socket.setTimeout(600);
    socket.once('connect', () => finish(true));
    socket.once('error', () => finish(false));
    socket.once('timeout', () => finish(false));
  });
}

(async () => {
  for (const [port, command, label] of [
    [8789, 'npm.cmd run care:server', 'sharing'],
    [8081, 'npm.cmd start -- --go --localhost --port 8081', 'patient'],
    [8082, 'npm.cmd run caregiver', 'caregiver'],
  ]) {
    if (await listening(port)) { console.log(`${label}: port ${port} already running.`); continue; }
    const output = fs.openSync(path.join(logDirectory, `${label}.log`), 'a');
    const error = fs.openSync(path.join(logDirectory, `${label}.err.log`), 'a');
    const child = spawn('cmd.exe', ['/d', '/c', command], { cwd: projectDirectory, windowsHide: true, detached: true, stdio: ['ignore', output, error] });
    child.on('error', cause => console.error(`${label}: ${cause.message}`));
    child.unref();
    fs.closeSync(output); fs.closeSync(error);
    console.log(`${label}: started (PID ${child.pid}).`);
  }
  console.log('Patient: http://localhost:8081/settings');
  console.log('Caregiver: http://localhost:8082');
  console.log('Local preview only. No APK is built. Logs: .preview/caregiver');
})();
