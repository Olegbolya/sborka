import { api, upload } from '../api-browser.js';

/** Основание использования шрифта: свободная лицензия, купленная веб-лицензия, собственная работа. */
export type FontLicense = 'OFL' | 'PURCHASED_WEB' | 'OWN_WORK';

export const FONT_LICENSE_LABELS: Record<FontLicense, string> = {
  OFL: 'Свободная лицензия (OFL)',
  PURCHASED_WEB: 'Куплена веб-лицензия',
  OWN_WORK: 'Это моя собственная работа',
};

/** TH-04 · DTO пользовательского шрифта. */
export interface FontDto {
  id: string;
  family: string;
  /** styleKey → { mediaId } */
  styles: Record<string, { mediaId: string }>;
  hasCyrillic: boolean;
  license: FontLicense | null;
  createdAt: string;
}

/** TH-04 · загрузить файл шрифта (TTF/OTF/WOFF/WOFF2, не более 10 МБ). */
export async function uploadFont(file: File, license: FontLicense): Promise<FontDto> {
  const form = new FormData();
  form.append('file', file);
  form.append('license', license);
  return upload<FontDto>('/fonts', form);
}

/** TH-04 · список шрифтов текущего пользователя. */
export async function listFonts(): Promise<FontDto[]> {
  return api<FontDto[]>('/fonts');
}

/** TH-04 · удалить шрифт по ID. */
export async function deleteFont(id: string): Promise<void> {
  await api<void>(`/fonts/${encodeURIComponent(id)}`, { method: 'DELETE' });
}
