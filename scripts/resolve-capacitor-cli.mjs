import { createRequire } from 'node:module';
import path from 'node:path';

export function resolveCapacitorCli(mobileDir) {
  // Node resolves both workspace-local and hoisted npm dependencies.
  return createRequire(path.join(mobileDir, 'package.json')).resolve('@capacitor/cli/bin/capacitor');
}
