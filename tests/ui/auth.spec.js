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
