/* global document */
import { readFileSync } from 'node:fs';
import { expect, test } from '@playwright/test';

test('actual DOM treats malicious campaign text as one attribute value', async ({ page }) => {
  const source = readFileSync(new URL('../../mobile/src/ui-utils.js', import.meta.url), 'utf8');
  await page.route('**/audit-ui-utils.js', (route) => route.fulfill({ contentType: 'text/javascript', body: source }));
  await page.goto('/');
  const result = await page.evaluate(async () => {
    const { escapeHtml } = await import('/audit-ui-utils.js');
    const payload = 'Test" style="position:fixed;inset:0;z-index:999999';
    const root = document.createElement('div');
    root.innerHTML = `<button data-campaign-name="${escapeHtml(payload)}">Przyjmij</button>`;
    return { value: root.firstChild.dataset.campaignName, injected: root.firstChild.hasAttribute('style') };
  });
  expect(result.injected).toBe(false);
  expect(result.value).toBe('Test" style="position:fixed;inset:0;z-index:999999');
});

test('framed app does not render account controls', async ({ page, baseURL }) => {
  // Same-origin framing isolates the application guard from network access policy.
  const frameHost = new URL('/audit-frame-host', baseURL).href;
  await page.route(frameHost, (route) =>
    route.fulfill({
      contentType: 'text/html',
      body: `<iframe src="${baseURL}/"></iframe>`,
    }),
  );
  await page.goto(frameHost);
  const frame = page.frameLocator('iframe');
  await expect(frame.locator('body')).toContainText('Otwórz D&D Companion bezpośrednio');
  await expect(frame.locator('#login-form')).toHaveCount(0);
});
