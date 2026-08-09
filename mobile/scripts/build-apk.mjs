import { copyFile, mkdir, readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const mobileDir = path.resolve(__dirname, '..');
const requiredSigningVariables = [
  'DND_RELEASE_STORE_FILE',
  'DND_RELEASE_STORE_PASSWORD',
  'DND_RELEASE_KEY_ALIAS',
  'DND_RELEASE_KEY_PASSWORD',
];

for (const variable of requiredSigningVariables) {
  if (!process.env[variable]) throw new Error(`Missing release signing variable: ${variable}`);
}

function run(command, args, cwd = mobileDir) {
  const result = spawnSync(command, args, { cwd, stdio: 'inherit', env: process.env });
  if (result.status !== 0) throw new Error(`${command} failed with exit code ${result.status}`);
}

const release = JSON.parse(await readFile(path.resolve(mobileDir, '../release.json'), 'utf8'));
const version = String(release.version || '');
if (!/^\d+\.\d+\.\d+$/.test(version)) throw new Error('Invalid version in release.json');

run('npm', ['run', 'build']);
run(process.execPath, [path.join(mobileDir, 'node_modules', '@capacitor', 'cli', 'bin', 'capacitor'), 'sync', 'android']);
run('./gradlew', ['assembleRelease'], path.join(mobileDir, 'android'));

const source = path.join(mobileDir, 'android', 'app', 'build', 'outputs', 'apk', 'release', 'app-release.apk');
const releaseDir = path.join(mobileDir, 'release');
const filename = `DnDCompanion-${version}.apk`;
const destination = path.join(releaseDir, filename);
await mkdir(releaseDir, { recursive: true });
await copyFile(source, destination);

const apk = await readFile(destination);
const checksum = createHash('sha256').update(apk).digest('hex');
await writeFile(`${destination}.sha256`, `${checksum}  ${filename}\n`);
console.log(`Release APK: ${destination}`);
console.log(`SHA-256: ${checksum}`);
