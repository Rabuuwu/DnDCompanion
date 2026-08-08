import { mkdir, readFile, copyFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '..');

const indexHtml = await readFile(path.join(rootDir, 'index.html'), 'utf8');
const versionMatch = indexHtml.match(/window\.__APP_VERSION__\s*=\s*['"]([^'"]+)['"]/);
const version = versionMatch?.[1] || 'dev';

const sourceFile = path.join(rootDir, 'android', 'app', 'build', 'outputs', 'apk', 'debug', 'app-debug.apk');
const outputDir = path.join(rootDir, 'download');
const versionedFile = path.join(outputDir, `app-debug-${version}.apk`);
const legacyFile = path.join(outputDir, 'app-debug.apk');

await mkdir(outputDir, { recursive: true });
await copyFile(sourceFile, versionedFile);
await copyFile(sourceFile, legacyFile);

const metadata = {
  version,
  generatedAt: new Date().toISOString(),
  apk: `app-debug-${version}.apk`,
  iosUrl: process.env.IOS_DOWNLOAD_URL || null,
  iosVersion: process.env.IOS_APP_VERSION || null,
};

await writeFile(path.join(outputDir, 'build-info.json'), JSON.stringify(metadata, null, 2));

console.log(`APK copied to ${versionedFile}`);
console.log(`Legacy APK updated at ${legacyFile}`);
console.log(`Build metadata written to ${path.join(outputDir, 'build-info.json')}`);
