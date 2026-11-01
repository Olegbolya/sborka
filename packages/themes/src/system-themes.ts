/**
 * TH-05 · Starter system themes. Three themes shipped out of the box, as pure data
 * (ADR-012: themes are data, not code). Each one is defined by `ThemeTokens` only:
 * palette, fonts (OFL-free system families via `kind: 'system'`), background, particles
 * and system screens. No external assets, so `check-licenses` stays green and nothing
 * is pulled from stock or meme sites (per docs/05-LEGAL.md §2.10).
 *
 * The administrator can publish more system themes from any project or own theme later
 * (AD-11, apps/api/src/admin/system-content.service.ts). This file provides the baseline
 * set required by TH-05: «Новогодний уют», «Светлая нейтральная», «Тёмная нейтральная».
 */
import type { ThemeTokens } from '@blokum/schema';

export interface SystemThemeDefinition {
  /** Stable id used as the primary key in `themes.id` so startup seeding is idempotent. */
  readonly id: string;
  readonly name: string;
  readonly tokens: ThemeTokens;
}

/** Builds the tokens object: everything else gets defaulted by `ThemeTokens.parse`. */
function makeTokens(tokens: ThemeTokens): ThemeTokens {
  return tokens;
}

const NEW_YEAR: SystemThemeDefinition = {
  id: 'sys-theme-newyear',
  name: 'Новогодний уют',
  tokens: makeTokens({
    colors: {
      background: '#2A0F15',
      surface: '#3D1821',
      primary: '#C8362C',
      accent: '#F2C14E',
      text: '#FFF8EE',
      muted: '#D7B98E',
      success: '#4C9A5A',
      error: '#E05263',
      // Own colours (TH-01: creator may add any under any key).
      gold: '#E8B64C',
      pine: '#1F3A2A',
      snow: '#F7F2E8',
    },
    fonts: {
      heading: { kind: 'system', name: 'serif' },
      body: { kind: 'system', name: 'sans' },
      accent: { kind: 'system', name: 'rounded' },
    },
    background: [
      { kind: 'solid', color: { token: 'background', alpha: 1 } },
      {
        kind: 'radial',
        cx: 0.5,
        cy: 0.15,
        stops: [
          { offset: 0, color: { token: 'primary', alpha: 0.35 } },
          { offset: 1, color: { token: 'background', alpha: 0 } },
        ],
      },
    ],
    particles: {
      preset: 'snow',
      density: 0.5,
      speed: 0.7,
      size: 1,
      rotation: true,
      wind: 0.1,
      onlyAtStart: false,
      images: [],
    },
    transitions: [],
    decor: [],
    sounds: {},
    blockDefaults: {},
    systemScreens: {
      closed: { background: [], title: 'Сборка закрыта', text: 'Загляните позже — вернёмся к ёлке.' },
      password: { background: [], title: 'Пароль', text: 'Введите пароль, который дал организатор.' },
      age18: { background: [], title: 'Только для взрослых', text: 'Эта сборка не для детей.' },
    },
  }),
};

const LIGHT: SystemThemeDefinition = {
  id: 'sys-theme-light',
  name: 'Светлая нейтральная',
  tokens: makeTokens({
    colors: {
      background: '#FBFAF7',
      surface: '#FFFFFF',
      primary: '#2E5EAA',
      accent: '#E07A5F',
      text: '#1D1B18',
      muted: '#6B665D',
      success: '#2F9E44',
      error: '#D6336C',
    },
    fonts: {
      heading: { kind: 'system', name: 'sans' },
      body: { kind: 'system', name: 'sans' },
    },
    background: [{ kind: 'solid', color: { token: 'background', alpha: 1 } }],
    transitions: [],
    decor: [],
    sounds: {},
    blockDefaults: {},
    systemScreens: {
      closed: { background: [], title: 'Сборка закрыта', text: 'Автор пока не открыл её.' },
      password: { background: [], title: 'Нужен пароль', text: 'Пароль дал тот, кто позвал вас сюда.' },
      age18: { background: [], title: 'Только с 18 лет', text: 'Эта сборка не для детей.' },
    },
  }),
};

const DARK: SystemThemeDefinition = {
  id: 'sys-theme-dark',
  name: 'Тёмная нейтральная',
  tokens: makeTokens({
    colors: {
      background: '#141618',
      surface: '#1F2225',
      primary: '#6EA8E7',
      accent: '#F2A65A',
      text: '#F2F2F0',
      muted: '#A8ADB2',
      success: '#5CC37A',
      error: '#F26B6B',
    },
    fonts: {
      heading: { kind: 'system', name: 'sans' },
      body: { kind: 'system', name: 'sans' },
    },
    background: [{ kind: 'solid', color: { token: 'background', alpha: 1 } }],
    transitions: [],
    decor: [],
    sounds: {},
    blockDefaults: {},
    systemScreens: {
      closed: { background: [], title: 'Сборка закрыта', text: 'Автор пока не открыл её.' },
      password: { background: [], title: 'Нужен пароль', text: 'Пароль дал тот, кто позвал вас сюда.' },
      age18: { background: [], title: 'Только с 18 лет', text: 'Эта сборка не для детей.' },
    },
  }),
};

/** Starter set required by TH-05. Order is stable: used by seeding and `list(scope: 'system')`. */
export const SYSTEM_THEMES: ReadonlyArray<SystemThemeDefinition> = [NEW_YEAR, LIGHT, DARK];

/** Names exposed to callers that only need to assert the TH-05 baseline. */
export const SYSTEM_THEME_NAMES = SYSTEM_THEMES.map((t) => t.name);
