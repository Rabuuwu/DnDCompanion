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

  await page.locator('[data-character-tab="notebook"]').click();
  await page.locator('#notebook-text').fill('Notatka zapisywana automatycznie');
  await expect(page.locator('#notebook-text')).toHaveValue('Notatka zapisywana automatycznie');
});
