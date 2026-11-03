import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import vm from 'node:vm';

// Run the real module with explicit external boundaries; never load .env or db.
export function loadCommonJs(path, dependencies, globals = {}) {
  const url = new URL(path, import.meta.url);
  const require = createRequire(url);
  const context = {
    module: { exports: {} },
    require(name) {
      return Object.hasOwn(dependencies, name) ? dependencies[name] : require(name);
    },
    console,
    Buffer,
    URL,
    Date,
    setTimeout,
    clearTimeout,
    setInterval,
    clearInterval,
    ...globals,
  };
  vm.runInNewContext(readFileSync(url, 'utf8'), context, { filename: url.pathname });
  return context.module.exports;
}
