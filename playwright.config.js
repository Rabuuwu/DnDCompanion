import { defineConfig } from '@playwright/test';

if (String(process.env.VITE_API_PROXY_TARGET || '').includes('onrender.com')) {
  throw new Error('Testy UI nie mogą korzystać z produkcyjnego API Render.');
}

export default defineConfig({
  testDir: './tests/ui',
  timeout: 30_000,
  retries: 1,
  use: {
    baseURL: 'http://127.0.0.1:4173',
    trace: 'retain-on-failure',
  },
  webServer: {
    command: 'npm run preview --workspace mobile -- --host 127.0.0.1',
    url: 'http://127.0.0.1:4173',
    reuseExistingServer: false,
  },
});
