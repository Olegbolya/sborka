import { expect, type Page } from '@playwright/test';
import { totpCode } from './totp';

/** A new user number for the provider emulator (it accepts up to 12 digits): every test signs in as its own person (ADR-034). */
export function freshUser(prefix: string): { id: string; name: string } {
  const id = String(100_000_000_000 + Math.floor(Math.random() * 899_999_999_999));
  return { id, name: `${prefix} ${id.slice(-4)}` };
}

export type Provider = 'vk' | 'yandex';

const PROVIDER_TITLE: Record<Provider, string> = { vk: 'VK ID', yandex: 'Яндекс ID' };

/**
 * Signs in the way a person does: the login page → the provider's page (the emulator) → back to the site.
 * Ends on whatever page the site opens after the callback (onboarding for a new user).
 */
export async function loginViaEmulator(page: Page, user: { id: string; name: string }, provider: Provider = 'vk'): Promise<void> {
  await page.goto('/login');
  await page.getByRole('link', { name: `Войти через ${PROVIDER_TITLE[provider]}` }).click();
  await expect(page.getByRole('heading', { name: new RegExp(`Dev-эмулятор: ${PROVIDER_TITLE[provider]}`) })).toBeVisible();
  await page.getByLabel('ID пользователя').fill(user.id);
  await page.getByLabel('Имя').fill(user.name);
  await page.getByRole('button', { name: `Войти через ${PROVIDER_TITLE[provider]}` }).click();
  await page.waitForURL(/\/(onboarding|cabinet\/projects)/);
}

/** Signs in and accepts the required consents, so the test starts on the cabinet. */
export async function loginAndOnboard(page: Page, user: { id: string; name: string }, provider: Provider = 'vk'): Promise<void> {
  await loginViaEmulator(page, user, provider);
  if (page.url().includes('/onboarding')) {
    await page.getByLabel('Принимаю').check();
    await page.getByLabel(/обработку персональных данных/).check();
    await page.getByLabel(/18 лет/).check();
    await page.getByRole('button', { name: 'Продолжить' }).click();
    await page.waitForURL(/\/cabinet\/projects/);
  }
}

/**
 * Signs in as an administrator the way a person does the first time: the provider's page → the setup of the second step (the key
 * is read from the page and the code made from it) → the reserve codes. The account must be named in ADMIN_ACCOUNTS (scripts/e2e-api.sh)
 * and have no key yet — the script clears the e2e administrators when the API starts.
 */
export async function adminLogin(page: Page, user: { id: string; name: string }): Promise<void> {
  await page.goto('/login');
  await page.getByRole('link', { name: 'Войти через VK ID' }).click();
  await page.getByLabel('ID пользователя').fill(user.id);
  await page.getByLabel('Имя').fill(user.name);
  await page.getByRole('button', { name: /^Войти через/ }).click();
  await page.waitForURL(/\/login\/2fa/);
  const secret = (await page.getByTestId('totp-secret').textContent())!.trim();
  await page.getByLabel('Код', { exact: true }).fill(totpCode(secret));
  await page.getByRole('button', { name: 'Подтвердить' }).click();
  await expect(page.getByTestId('backup-codes')).toContainText('Резервные коды');
  await page.getByRole('button', { name: 'Я сохранил(а) коды' }).click();
  await page.waitForURL(/\/(onboarding|cabinet\/projects)/);
}

/** The numbers of the e2e administrators of this browser project: A, B, C and D (scripts/e2e-api.sh). */
export function adminIds(info: { project: { name: string } }): { a: string; b: string; c: string; d: string } {
  return info.project.name.startsWith('mobile') ? { a: '700000000021', b: '700000000022', c: '700000000023', d: '700000000024' } : { a: '700000000011', b: '700000000012', c: '700000000013', d: '700000000014' };
}
