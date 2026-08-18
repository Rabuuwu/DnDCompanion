import { spawn } from 'node:child_process';
import { networkInterfaces } from 'node:os';

const root = new URL('..', import.meta.url).pathname;
const children = new Set();
const apiPort = process.env.BRANCH_PREVIEW_API_PORT || '3010';

function run(command, args, options = {}) {
  const child = spawn(command, args, {
    cwd: root,
    env: { ...process.env, ...options.env },
    stdio: 'inherit',
  });
  children.add(child);
  child.once('exit', () => children.delete(child));
  return child;
}

function wait(child) {
  return new Promise((resolve, reject) => {
    child.once('error', reject);
    child.once('exit', (code, signal) => {
      if (code === 0) resolve();
      else reject(new Error(`Proces zakończył się kodem ${code ?? signal}`));
    });
  });
}

function stop(signal = 'SIGTERM') {
  for (const child of children) {
    if (!child.killed) child.kill(signal);
  }
}

process.on('SIGINT', () => {
  stop('SIGINT');
  process.exitCode = 130;
});
process.on('SIGTERM', () => stop('SIGTERM'));
process.on('exit', () => stop());

try {
  console.log('[preview] Stosowanie brakujących migracji lokalnej bazy…');
  await wait(run('npm', ['run', 'db:migrate']));

  const api = run('npm', ['run', 'start', '--workspace', 'server'], {
    env: { PORT: apiPort, HOST: '127.0.0.1' },
  });
  const frontend = run(
    'npm',
    ['run', 'dev', '--workspace', 'mobile', '--', '--host', '0.0.0.0', '--port', '5173', '--strictPort'],
    { env: { VITE_API_PROXY_TARGET: `http://127.0.0.1:${apiPort}` } },
  );

  const addresses = Object.values(networkInterfaces())
    .flat()
    .filter((entry) => entry?.family === 'IPv4' && !entry.internal)
    .map((entry) => entry.address);

  console.log('\n[preview] Podgląd brancha z hot reloadem:');
  console.log('  komputer: http://127.0.0.1:5173');
  addresses.forEach((address) => console.log(`  LAN:      http://${address}:5173`));
  console.log('  API i PostgreSQL są dostępne przez proxy /api.');
  console.log('  Zakończ podgląd skrótem Ctrl+C.\n');

  await Promise.race([
    wait(api).then(() => {
      throw new Error('API zostało zatrzymane');
    }),
    wait(frontend).then(() => {
      throw new Error('Frontend został zatrzymany');
    }),
  ]);
} catch (error) {
  console.error(`[preview] ${error.message}`);
  stop();
  process.exitCode = 1;
}
