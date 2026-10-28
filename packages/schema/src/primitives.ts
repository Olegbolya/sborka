import { z } from './locale.js';
import { idSchema } from './ids.js';
import { THEME_COLOR_ROLES } from './color-roles.js';

export const Id = idSchema;
export type Id = z.infer<typeof Id>;

/** Finite number in a closed range; NaN and ±Infinity are rejected by zod. */
export const num = (min: number, max: number) => z.number().min(min).max(max);
export const int = (min: number, max: number) => z.number().int().min(min).max(max);

export const HexColor = z
  .string()
  .regex(/^#[0-9a-fA-F]{6}([0-9a-fA-F]{2})?$/, 'Цвет задаётся в формате #RRGGBB или #RRGGBBAA');

/** Semantic colour roles every theme has (TH-01); themes may add any number of own colours. */
export const ThemeColorRole = z.enum(THEME_COLOR_ROLES);

export const ColorKey = z
  .string()
  .min(1)
  .max(40)
  .regex(/^[A-Za-z0-9_-]+$/, 'Имя цвета темы — латиница, цифры, «_» или «-»');

/** A literal colour or a reference to a theme colour (role or own colour), optionally with transparency. */
export const Color = z.union([
  z.strictObject({ hex: HexColor }),
  z.strictObject({ token: ColorKey, alpha: num(0, 1).default(1) }),
]);
export type Color = z.infer<typeof Color>;

/** User file from the creator's media library or an item of the platform library (LB-02). */
export const MediaRef = z.discriminatedUnion('source', [
  z.strictObject({ source: z.literal('media'), id: Id }),
  z.strictObject({ source: z.literal('library'), id: Id }),
]);
export type MediaRef = z.infer<typeof MediaRef>;

export const Point = z.strictObject({ x: num(-10000, 10000), y: num(-10000, 10000) });
export const UnitPoint = z.strictObject({ x: num(0, 1), y: num(0, 1) });
export const Rect = z.strictObject({ x: num(-10000, 10000), y: num(-10000, 10000), w: num(0, 10000), h: num(0, 10000) });
export type Rect = z.infer<typeof Rect>;

export const Easing = z.union([
  z.strictObject({ kind: z.literal('preset'), name: z.enum(['linear', 'ease', 'easeIn', 'easeOut', 'easeInOut']) }),
  z.strictObject({ kind: z.literal('spring'), stiffness: num(10, 1000).default(170), damping: num(1, 100).default(26) }),
  z.strictObject({
    kind: z.literal('bezier'),
    x1: num(0, 1),
    y1: num(-2, 3),
    x2: num(0, 1),
    y2: num(-2, 3),
  }),
]);
export type Easing = z.infer<typeof Easing>;
export const DEFAULT_EASING: Easing = { kind: 'preset', name: 'easeOut' };

/** Identifier of a variable: letters (latin or cyrillic), digits and «_», starts with a letter or «_». */
export const VariableName = z
  .string()
  .min(1)
  .max(40)
  .regex(/^[A-Za-zА-Яа-яЁё_][A-Za-zА-Яа-яЁё0-9_]*$/, 'Имя переменной — буквы, цифры и «_», начинается с буквы');
