import { readFile } from 'node:fs/promises';

const root = new URL('../', import.meta.url);
const release = JSON.parse(await readFile(new URL('release.json', root), 'utf8'));
const changelog = JSON.parse(await readFile(new URL('server/data/changelog.json', root), 'utf8'));
const expected = String(process.env.RELEASE_VERSION || release.version).replace(/^v/, '');

const errors = [];
if (!/^\d+\.\d+\.\d+$/.test(release.version)) errors.push('version must use x.y.z format');
if (!Number.isSafeInteger(release.androidVersionCode) || release.androidVersionCode < 1) {
  errors.push('androidVersionCode must be a positive integer');
}
if (!/^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*)+$/.test(release.androidPackageId)) {
  errors.push('androidPackageId is invalid');
}
if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(release.repository)) errors.push('repository is invalid');
if (release.version !== expected) errors.push(`release.json version ${release.version} does not match ${expected}`);
if (changelog[0]?.version !== release.version) errors.push('latest changelog version does not match release.json');

if (errors.length) {
  console.error(`Release metadata validation failed:\n- ${errors.join('\n- ')}`);
  process.exit(1);
}

const apkUrl = `https://github.com/${release.repository}/releases/download/v${release.version}/DnDCompanion-${release.version}.apk`;
console.log(`Release ${release.version} (Android code ${release.androidVersionCode}) is consistent.`);
console.log(`APK URL: ${apkUrl}`);
