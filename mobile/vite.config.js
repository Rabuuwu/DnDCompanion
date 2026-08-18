import { defineConfig } from 'vite';
import { readFileSync } from 'node:fs';

const https =
  process.env.PWA_HTTPS_KEY && process.env.PWA_HTTPS_CERT
    ? {
        key: readFileSync(process.env.PWA_HTTPS_KEY),
        cert: readFileSync(process.env.PWA_HTTPS_CERT),
      }
    : undefined;
const release = JSON.parse(readFileSync(new URL('../release.json', import.meta.url), 'utf8'));

const apiProxyTarget = process.env.VITE_API_PROXY_TARGET || 'http://127.0.0.1:3000';
const proxy = {
  '/api': apiProxyTarget,
  '/health': apiProxyTarget,
  '/ready': apiProxyTarget,
};

export default defineConfig({
  base: process.env.PWA_BASE || '/',
  define: {
    __DND_APP_VERSION__: JSON.stringify(release.version),
  },
  build: {
    outDir: process.env.PWA_OUT_DIR || 'dist',
  },
  server: {
    host: '0.0.0.0',
    port: 3000,
    strictPort: false,
    https,
    proxy,
  },
  preview: {
    host: '0.0.0.0',
    port: 4173,
    strictPort: false,
    https,
    proxy,
  },
});
