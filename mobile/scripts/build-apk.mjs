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

const indexHtml = await readFile(path.join(mobileDir, 'index.html'), 'utf8');
const version = indexHtml.match(/window\.__APP_VERSION__\s*=\s*['"]([^'"]+)['"]/)?.[1];
if (!version) throw new Error('Unable to read application version from mobile/index.html');

run('npm', ['run', 'build']);
run('npx', ['cap', 'sync', 'android']);
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
