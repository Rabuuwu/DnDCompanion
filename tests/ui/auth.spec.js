import { expect, test } from '@playwright/test';

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
  await page.locator('#character-form button[type="submit"]').click();
  await expect(page.getByText('Testowy bohater').first()).toBeVisible();

  await page.locator('[data-view-character]').first().click();
  await page.locator('[data-character-tab="inventory"]').click();
  await page.locator('#open-add-inventory-item').click();
  await page.locator('#inventory-item-form [name="name"]').fill('Mikstura leczenia');
  await page.locator('#inventory-item-form [name="quantity"]').fill('2');
  await page.locator('#inventory-item-form button[type="submit"]').click();
  await expect(page.getByText('Mikstura leczenia').first()).toBeVisible();
});
