import { type ThemeTokens } from '@blokum/schema';
import { api, upload } from '../api-browser';

export interface ThemeSummary {
  id: string;
  name: string;
  isSystem: boolean;
  isDefault: boolean;
  colors: Record<string, string>;
  updatedAt: string;
}

export interface ThemeFull {
  id: string;
  name: string;
  tokens: ThemeTokens;
  isSystem: boolean;
  isDefault: boolean;
  createdAt: string;
  updatedAt: string;
}

export const listThemes = (scope: 'mine' | 'system'): Promise<ThemeSummary[]> => api(`/themes?scope=${scope}`);
export const getTheme = (id: string): Promise<ThemeFull> => api(`/themes/${encodeURIComponent(id)}`);
export const createTheme = (name: string, tokens?: ThemeTokens): Promise<ThemeFull> => api('/themes', { method: 'POST', body: { name, ...(tokens ? { tokens } : {}) } });
export const saveTheme = (id: string, body: { name?: string; tokens?: ThemeTokens }): Promise<ThemeFull> => api(`/themes/${encodeURIComponent(id)}`, { method: 'PUT', body });
export const deleteTheme = (id: string): Promise<void> => api(`/themes/${encodeURIComponent(id)}`, { method: 'DELETE' });
export const duplicateTheme = (id: string): Promise<ThemeFull> => api(`/themes/${encodeURIComponent(id)}/duplicate`, { method: 'POST' });
export const setDefaultTheme = (id: string, value: boolean): Promise<ThemeFull> => api(`/themes/${encodeURIComponent(id)}/default`, { method: 'POST', body: { value } });
export const themeFromProject = (projectId: string, name: string): Promise<ThemeFull> => api(`/themes/from-project/${encodeURIComponent(projectId)}`, { method: 'POST', body: { name } });
export const themeFromMedia = (mediaId: string, name: string): Promise<ThemeFull> => api('/themes/from-image', { method: 'POST', body: { mediaId, name } });

/** TH-02 · a picture from the computer goes to the library and a theme is made from its colours. */
export async function themeFromFile(file: File, name: string): Promise<ThemeFull> {
  const form = new FormData();
  form.append('file', file);
  const media = await upload<{ id: string }>('/media', form);
  return themeFromMedia(media.id, name);
}
