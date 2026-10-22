import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

// Mutate temporary copies only. A failed process alone is insufficient: require
// a test assertion failure, so a broken import cannot masquerade as detection.
const root = fileURLToPath(new URL('../', import.meta.url));
const cases = [
  [
    'parser status',
    'server/src/http-errors.js',
    "status: 400, error: 'invalid_json'",
    "status: 500, error: 'invalid_json'",
    'http-errors',
  ],
  [
    'private exception logging',
    'server/src/http-errors.js',
    "console.error({ event: 'request_failed', requestId: req.auditRequestId || null });",
    'console.error(err);',
    'http-errors',
  ],
  [
    'production test guard',
    'server/scripts/test-safety.js',
    "if (env.NODE_ENV !== 'test')",
    'if (false)',
    'test-safety',
  ],
  [
    'database target guard',
    'server/scripts/test-safety.js',
    '!/(^|[_-])test([_-]|$)/i.test(databaseName)',
    'false',
    'test-safety',
  ],
  [
    'negative formula scaling',
    'server/src/formula-schema.js',
    'if (base < 0) return sum + base;',
    '',
    'formula-schema',
  ],
];
for (const [name, source, before, after, testName] of cases) {
  const temp = mkdtempSync(join(tmpdir(), 'dnd-regression-'));
  try {
    for (const path of ['package.json', 'server/package.json', source, `tests/unit/${testName}.test.js`]) {
      const target = join(temp, path);
      mkdirSync(dirname(target), { recursive: true });
      let content = readFileSync(join(root, path), 'utf8');
      if (path === source) {
        assert.ok(content.includes(before), `Missing mutation anchor: ${name}`);
        content = content.replace(before, after);
      }
      writeFileSync(target, content);
    }
    const result = spawnSync(process.execPath, ['--test', `tests/unit/${testName}.test.js`], {
      cwd: temp,
      encoding: 'utf8',
    });
    assert.notEqual(result.status, 0, `Undetected regression: ${name}`);
    assert.match(result.stdout + result.stderr, /ERR_ASSERTION/, `Mutation caused infrastructure failure: ${name}`);
    console.log(`Detected regression: ${name}`);
  } finally {
    rmSync(temp, { recursive: true, force: true });
  }
}
