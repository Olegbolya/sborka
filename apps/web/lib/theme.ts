/** Оформление сайта: как в системе, светлое или тёмное. Выбор хранится в cookie год, чтобы страница сразу пришла в нужных цветах. */
export type ThemeChoice = 'system' | 'light' | 'dark';
export const THEME_COOKIE = 'bk_theme';

export const themeOf = (raw: string | undefined): ThemeChoice => (raw === 'light' || raw === 'dark' ? raw : 'system');

export function readTheme(): ThemeChoice {
  const found = document.cookie.split(';').map((c) => c.trim().split('=')).find(([k]) => k === THEME_COOKIE);
  return themeOf(found?.[1]);
}

export function applyTheme(choice: ThemeChoice): void {
  if (choice === 'system') {
    document.cookie = `${THEME_COOKIE}=; Path=/; Max-Age=0; SameSite=Lax`;
    delete document.documentElement.dataset.theme;
  } else {
    document.cookie = `${THEME_COOKIE}=${choice}; Path=/; Max-Age=31536000; SameSite=Lax`;
    document.documentElement.dataset.theme = choice;
  }
}
