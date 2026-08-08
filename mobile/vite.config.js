import { defineConfig } from 'vite';
import { readFileSync } from 'node:fs';

const https = process.env.PWA_HTTPS_KEY && process.env.PWA_HTTPS_CERT
  ? {
      key: readFileSync(process.env.PWA_HTTPS_KEY),
      cert: readFileSync(process.env.PWA_HTTPS_CERT),
    }
  : undefined;

const proxy = {
  '/api': 'http://127.0.0.1:3000',
  '/health': 'http://127.0.0.1:3000',
  '/ready': 'http://127.0.0.1:3000',
};

export default defineConfig({
  base: process.env.PWA_BASE || '/',
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
