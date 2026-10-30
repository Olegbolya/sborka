import type { ProjectDocument } from '@blokum/schema';
import dedMoroz from '../examples/tpl-ded-moroz.json' with { type: 'json' };
import opros from '../examples/tpl-opros.json' with { type: 'json' };
import rg01 from '../examples/rg-01.json' with { type: 'json' };
import rg02 from '../examples/rg-02.json' with { type: 'json' };
import rg03 from '../examples/rg-03.json' with { type: 'json' };
import rg04 from '../examples/rg-04.json' with { type: 'json' };
import rg05 from '../examples/rg-05.json' with { type: 'json' };
import rg06 from '../examples/rg-06.json' with { type: 'json' };
import rg07 from '../examples/rg-07.json' with { type: 'json' };
import rg08 from '../examples/rg-08.json' with { type: 'json' };
import rg09 from '../examples/rg-09.json' with { type: 'json' };
import rg10 from '../examples/rg-10.json' with { type: 'json' };
import rsvp from '../examples/tpl-rsvp.json' with { type: 'json' };
import viktorina from '../examples/tpl-viktorina.json' with { type: 'json' };

/*
 * P10.3, P10.4 · стартовый набор системного содержимого (TH-05, TPL-03). Это данные: темы — только из встроенного (цвета,
 * градиенты, частицы, системные шрифты), шаблоны — обычные документы из блоков, правил и поведений. Внешних файлов (шрифтов,
 * картинок, звуков) в наборе нет, поэтому лицензий на них тоже нет. В библиотеку набор попадает только по кнопке администратора.
 */
export interface StarterTheme {
  /** Постоянный ключ: по нему набор не добавляется второй раз. */
  readonly key: string;
  readonly name: string;
  /** Входные токены темы: полный вид им придаёт `ThemeTokens.parse` (проверено тестом). */
  readonly tokens: Readonly<Record<string, unknown>>;
}
export interface StarterTemplate {
  readonly key: string;
  readonly name: string;
  readonly category: string;
  readonly sort: number;
  readonly document: ProjectDocument;
}

const round = (r: number) => ({ unit: 'u' as const, tl: r, tr: r, br: r, bl: r });
const buttonLook = (r: number) => ({ radius: round(r), fills: [{ kind: 'solid' as const, color: { token: 'primary', alpha: 1 } }], text: { weight: 800, paint: { kind: 'solid' as const, color: { token: 'surface', alpha: 1 } } } });
const soft = { id: 'perexod_myagko', name: 'Мягкое появление', transition: { kind: 'fade' as const, durationMs: 500, delayMs: 0, direction: 'left' as const, easing: { kind: 'preset' as const, name: 'easeOut' as const }, blur: 0, scale: 1 } };

export const STARTER_THEMES: readonly StarterTheme[] = [
  {
    key: 'novogodniy-uyut',
    name: 'Новогодний уют',
    tokens: {
      colors: { background: '#FDF6EC', surface: '#FFFFFF', primary: '#B3362A', accent: '#2F7D4F', text: '#2B1B16', muted: '#6B5A52', success: '#2F7D4F', error: '#C2255C' },
      fonts: { heading: { kind: 'system', name: 'serif' }, body: { kind: 'system', name: 'rounded' } },
      background: [{ kind: 'linear', angle: 180, stops: [{ offset: 0, color: { hex: '#FDF6EC' } }, { offset: 1, color: { hex: '#DCE9F5' } }] }],
      particles: { preset: 'snow', images: [], density: 0.45, speed: 0.9, size: 1, rotation: true, wind: 0.1, onlyAtStart: false },
      blockDefaults: { button: buttonLook(28) },
      transitions: [soft],
    },
  },
  {
    key: 'svetlaya-neytralnaya',
    name: 'Светлая нейтральная',
    tokens: {
      colors: { background: '#F7F7F5', surface: '#FFFFFF', primary: '#2F5DA8', accent: '#E4572E', text: '#1F2328', muted: '#5B6470', success: '#2F9E44', error: '#C92A2A' },
      fonts: { heading: { kind: 'system', name: 'sans' }, body: { kind: 'system', name: 'sans' } },
      background: [{ kind: 'solid', color: { token: 'background', alpha: 1 } }],
      blockDefaults: { button: buttonLook(12) },
      transitions: [soft],
    },
  },
  {
    key: 'tyomnaya-neytralnaya',
    name: 'Тёмная нейтральная',
    tokens: {
      colors: { background: '#121417', surface: '#1E2227', primary: '#8AB4FF', accent: '#F4B860', text: '#ECEFF4', muted: '#9AA4B2', success: '#5FCB7A', error: '#FF7B7B' },
      fonts: { heading: { kind: 'system', name: 'sans' }, body: { kind: 'system', name: 'sans' } },
      background: [{ kind: 'solid', color: { token: 'background', alpha: 1 } }],
      blockDefaults: { button: buttonLook(12) },
      transitions: [soft],
    },
  },
];

const doc = (d: unknown): ProjectDocument => d as ProjectDocument;
export const STARTER_TEMPLATES: readonly StarterTemplate[] = [
  { key: 'pismo-dedu-morozu', name: 'Письмо Деду Морозу', category: 'Праздники', sort: 10, document: doc(dedMoroz) },
  { key: 'viktorina-s-ballami', name: 'Викторина с баллами', category: 'Викторины', sort: 20, document: doc(viktorina) },
  { key: 'anonimnyy-opros', name: 'Анонимный опрос', category: 'Опросы', sort: 30, document: doc(opros) },
  { key: 'priglashenie-s-otvetom', name: 'Приглашение с ответом', category: 'Приглашения', sort: 40, document: doc(rsvp) },
  { key: 'rg-01', name: 'Убегающая кнопка «Нет»', category: 'Игры', sort: 101, document: doc(rg01) },
  { key: 'rg-02', name: 'Коробка-сюрприз', category: 'Игры', sort: 102, document: doc(rg02) },
  { key: 'rg-03', name: 'Скретч-карта', category: 'Игры', sort: 103, document: doc(rg03) },
  { key: 'rg-04', name: 'Колесо фортуны', category: 'Игры', sort: 104, document: doc(rg04) },
  { key: 'rg-05', name: 'Мемори «найди пары»', category: 'Игры', sort: 105, document: doc(rg05) },
  { key: 'rg-06', name: 'Поймай объект', category: 'Игры', sort: 106, document: doc(rg06) },
  { key: 'rg-07', name: 'Перетащи на место', category: 'Игры', sort: 107, document: doc(rg07) },
  { key: 'rg-08', name: 'Квест «Ключ от ёлки»', category: 'Игры', sort: 108, document: doc(rg08) },
  { key: 'rg-09', name: 'Кликер на время', category: 'Игры', sort: 109, document: doc(rg09) },
  { key: 'rg-10', name: 'Угадай по размытому фото', category: 'Игры', sort: 110, document: doc(rg10) },
];
