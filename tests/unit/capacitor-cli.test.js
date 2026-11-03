import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { resolveCapacitorCli } from '../../scripts/resolve-capacitor-cli.mjs';

for (const location of ['workspace', 'hoisted']) {
  test(`APK build resolves the ${location} Capacitor CLI`, (t) => {
    const directory = mkdtempSync(path.join(tmpdir(), 'dnd-cli-resolution-'));
    t.after(() => rmSync(directory, { recursive: true, force: true }));
    const mobile = path.join(directory, 'mobile');
    mkdirSync(mobile);
    writeFileSync(path.join(mobile, 'package.json'), '{"name":"fixture-app"}');
    const packageDir = path.join(location === 'workspace' ? mobile : directory, 'node_modules', '@capacitor', 'cli');
    mkdirSync(path.join(packageDir, 'bin'), { recursive: true });
    writeFileSync(path.join(packageDir, 'package.json'), '{"name":"@capacitor/cli","version":"8.4.2"}');
    const executable = path.join(packageDir, 'bin', 'capacitor');
    writeFileSync(executable, '// Fixture executable; never run.');
    assert.equal(resolveCapacitorCli(mobile), realpathSync(executable));
  });
}
