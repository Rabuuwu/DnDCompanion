import { expect, test } from '@playwright/test';

test.afterEach(async ({ page }) => {
  await page.evaluate(async () => {
    const session = JSON.parse(sessionStorage.getItem('dnd-mobile-session') || 'null');
    if (!session?.token) return;
    await fetch('/api/auth/account', {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${session.token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ password: 'Browser-test-password-123!' }),
    });
  });
});

test('użytkownik może zarejestrować konto i wejść do aplikacji', async ({ page }) => {
  const username = `ui_${Date.now()}`;
  await page.goto('/');
  await expect(page.locator('#login-form')).toBeVisible();
  await page.locator('#show-register').click();
  await page.locator('#register-username').fill(username);
  await page.locator('#register-password').fill('Browser-test-password-123!');
  await page.locator('#register-form button[type="submit"]').click();
  await expect(page.getByText(/Witaj/i).first()).toBeVisible();
});

test('użytkownik tworzy postać i dodaje przedmiot do ekwipunku', async ({ page }) => {
  const username = `ui_character_${Date.now()}`;
  await page.goto('/');
  await page.locator('#show-register').click();
  await page.locator('#register-username').fill(username);
  await page.locator('#register-password').fill('Browser-test-password-123!');
  await page.locator('#register-form button[type="submit"]').click();
  await expect(page.locator('#new-character-btn')).toBeVisible();

  await page.locator('#new-character-btn').click();
  await page.locator('#character-form [name="name"]').fill('Testowy bohater');
  await page.locator('#character-form [name="race"]').fill('Człowiek');
  await page.locator('#character-form [name="classes"]').fill('Wojownik');
  const combatSection = page
    .locator('details')
    .filter({ has: page.locator('summary', { hasText: 'Statystyki walki' }) });
  await combatSection.locator('summary').click();
  const hitFormula = page.locator('[data-stat-formula-builder="combat-hit"]');
  await hitFormula.locator('[data-add-formula-term]').click();
  const diceTerm = hitFormula.locator('[data-ranged-formula-term]').last();
  await diceTerm.locator('[data-formula-field="type"]').selectOption('dice');
  await diceTerm.locator('[data-formula-field="count"]').selectOption('2');
  await diceTerm.locator('[data-formula-field="sides"]').selectOption('20');
  await page.locator('#character-form button[type="submit"]').click();
  await expect(page.getByText('Testowy bohater').first()).toBeVisible();

  await page.locator('[data-edit-character]').first().click();
  const savedDiceTerm = page
    .locator('[data-stat-formula-builder="combat-hit"] [data-ranged-formula-term]')
    .filter({ has: page.locator('[data-formula-field="type"]') })
    .last();
  await expect(savedDiceTerm.locator('[data-formula-field="type"]')).toHaveValue('dice');
  await expect(savedDiceTerm.locator('[data-formula-field="count"]')).toHaveValue('2');
  await expect(savedDiceTerm.locator('[data-formula-field="sides"]')).toHaveValue('20');
  await page.locator('#cancel-character-btn').click();

  await page.locator('[data-view-character]').first().click();
  await page.locator('[data-character-tab="inventory"]').click();
  await page.locator('#open-add-inventory-item').click();
  await page.locator('#inventory-item-form [name="name"]').fill('Mikstura leczenia');
  await page.locator('#inventory-item-form [name="quantity"]').fill('2');
  await page.locator('#inventory-item-form button[type="submit"]').click();
  await expect(page.getByText('Mikstura leczenia').first()).toBeVisible();

  await page.locator('#open-add-inventory-item').click();
  await page.locator('#inventory-item-form [name="name"]').fill('Gold coins');
  await page.locator('#inventory-item-form [name="quantity"]').fill('1000000');
  const goldSaved = page.waitForResponse(
    (response) => response.url().endsWith('/inventory') && response.request().method() === 'PATCH',
  );
  await page.locator('#inventory-item-form button[type="submit"]').click();
  expect((await (await goldSaved).json()).inventory).toContain('Gold coins × 1000000');

  await page.locator('[data-edit-inventory-item]').filter({ hasText: 'Gold coins' }).click();
  await page.locator('[data-edit-inventory-form] [name="quantity"]').fill('2000000');
  const goldEdited = page.waitForResponse(
    (response) => response.url().endsWith('/inventory') && response.request().method() === 'PATCH',
  );
  await page.locator('[data-edit-inventory-form] button[type="submit"]').click();
  expect((await (await goldEdited).json()).inventory).toContain('Gold coins × 2000000');

  await page.locator('[data-character-tab="notebook"]').click();
  await page.locator('#notebook-text').fill('Notatka zapisywana automatycznie');
  await expect(page.locator('#notebook-text')).toHaveValue('Notatka zapisywana automatycznie');

  await page.locator('[data-notebook-menu-toggle]').click();
  await page.locator('[data-notebook-mode="draw"]').click();
  await page.locator('[data-notebook-color-toggle]').click();
  await page.locator('#notebook-color-wheel').click({ position: { x: 65, y: 40 } });
  const black = page.getByRole('button', { name: 'Czarny', exact: true });
  await expect(black).toHaveAttribute('aria-pressed', 'false');
  await black.click();
  await expect(black).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('#notebook-color-preview')).toHaveCSS('background-color', 'rgb(0, 0, 0)');
  await page.locator('[data-notebook-menu-toggle]').click();
  const canvas = await page.locator('#notebook-canvas').boundingBox();
  expect(canvas).not.toBeNull();
  const strokeSaved = page.waitForResponse(
    (response) =>
      response.url().endsWith('/notebook') &&
      response.request().method() === 'PATCH' &&
      response.request().postDataJSON().notebook.strokes.length > 0,
  );
  await page.mouse.move(canvas.x + canvas.width / 2, canvas.y + canvas.height / 2);
  await page.mouse.down();
  await page.mouse.move(canvas.x + canvas.width / 2 + 20, canvas.y + canvas.height / 2 + 10);
  await page.mouse.up();
  expect((await (await strokeSaved).json()).notebook.strokes.at(-1).color).toBe('#000000');
});
