// Offline regression checks for the security audit fixes. Never accesses .env or a database.
import { readdirSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = new URL('../', import.meta.url);
const tests = readdirSync(new URL('tests/unit/', root))
  .filter((name) => name.endsWith('-security.test.js'))
  .map((name) => `tests/unit/${name}`);
const result = spawnSync(process.execPath, ['--test', ...tests], {
  cwd: fileURLToPath(root),
  stdio: 'inherit',
});
if (result.error) throw result.error;
process.exitCode = result.status ?? 1;
