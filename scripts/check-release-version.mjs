import { readFile } from 'node:fs/promises';

const files = {
  html: await readFile(new URL('../mobile/index.html', import.meta.url), 'utf8'),
  gradle: await readFile(new URL('../mobile/android/app/build.gradle', import.meta.url), 'utf8'),
  exampleEnv: await readFile(new URL('../.env.example', import.meta.url), 'utf8'),
  changelog: JSON.parse(await readFile(new URL('../server/data/changelog.json', import.meta.url), 'utf8')),
};

const versions = {
  html: files.html.match(/window\.__APP_VERSION__\s*=\s*['"]([^'"]+)['"]/)?.[1],
  android: files.gradle.match(/versionName\s+["']([^"']+)["']/)?.[1],
  environment: files.exampleEnv.match(/^ANDROID_APP_VERSION=(.+)$/m)?.[1],
  changelog: files.changelog[0]?.version,
};
const expected = process.env.RELEASE_VERSION || versions.html;
const mismatches = Object.entries(versions).filter(([, version]) => version !== expected);
if (mismatches.length) {
  console.error(`Release version mismatch; expected ${expected}:`, versions);
  process.exit(1);
}

const expectedUrl = `/releases/download/v${expected}/DnDCompanion-${expected}.apk`;
if (!files.exampleEnv.includes(expectedUrl)) {
  console.error(`ANDROID_APK_URL must contain ${expectedUrl}`);
  process.exit(1);
}
console.log(`Release metadata is consistent for ${expected}.`);
