import { createRequire } from 'node:module';

// fontkit не имеет TypeScript-типов — импортируем через require для CJS-совместимости.
const _require = createRequire(import.meta.url);
const fontkit = _require('fontkit') as {
  create: (buf: Buffer) => {
    familyName: string | undefined;
    subfamilyName: string | undefined;
    characterSet: number[];
    copyright?: string;
    manufacturer?: string;
    license?: string;
    [key: string]: unknown;
  };
};
const subsetFont = _require('subset-font') as (
  buf: Buffer,
  text: undefined,
  opts: { keepAllGlyphs: true; targetFormat: 'woff2' },
) => Promise<Buffer>;

/** Максимальный размер файла шрифта (TS-26). */
export const FONT_MAX_BYTES = 10 * 1024 * 1024;

/** Сигнатуры поддерживаемых форматов шрифтов. */
const FONT_SIGNATURES: Array<{ hex: string; name: string }> = [
  { hex: '774f4632', name: 'WOFF2' },
  { hex: '00010000', name: 'TTF' },
  { hex: '4f54544f', name: 'OTF' },
  { hex: '774f4646', name: 'WOFF1' },
];

/** Диапазон кодпоинтов кириллицы (U+0400…U+04FF). */
const CYRILLIC_START = 0x0400;
const CYRILLIC_END = 0x04ff;

/** Основание, по которому создатель вправе использовать шрифт (ADR-048). */
export const FONT_LICENSES = ['OFL', 'PURCHASED_WEB', 'OWN_WORK'] as const;
export type FontLicense = (typeof FONT_LICENSES)[number];

export function isFontLicense(value: unknown): value is FontLicense {
  return typeof value === 'string' && (FONT_LICENSES as readonly string[]).includes(value);
}

/**
 * Известные коммерческие словолитни. Если в метаданных шрифта (copyright, производитель, код производителя,
 * текст лицензии) есть одно из этих названий, а создатель заявил свободную лицензию OFL, файл не принимается:
 * для такого шрифта нужна купленная веб-лицензия.
 */
export const COMMERCIAL_FONT_VENDORS: readonly string[] = [
  'monotype',
  'linotype',
  'itc ',
  'agfa',
  'berthold',
  'fontfont',
  'fontshop',
  'bitstream',
  'hoefler',
  'commercial type',
  'type network',
  'emigre',
  'village type',
  'dalton maag',
  'lineto',
  'klim type',
  'grilli type',
  'colophon foundry',
];

/** Название коммерческой словолитни из метаданных шрифта или null. */
export function commercialVendor(meta: { copyright: string | null; manufacturer: string | null; vendorId: string | null; licenseText: string | null }): string | null {
  const hay = [meta.copyright, meta.manufacturer, meta.licenseText].filter(Boolean).join(' \n ').toLowerCase();
  for (const v of COMMERCIAL_FONT_VENDORS) if (hay.includes(v)) return v.trim();
  const code = meta.vendorId?.trim().toUpperCase();
  if (code && ['MONO', 'LINO', 'AGFA', 'BITS', 'FSHP', 'HOEF'].includes(code)) return code;
  return null;
}

export interface FontProcessResult {
  /** Текст авторских прав из таблицы имён шрифта (nameID 0). */
  copyright: string | null;
  family: string;
  /** Ключ стиля: «400», «700», «400i», «700i» и т. д. */
  styleKey: string;
  hasCyrillic: boolean;
  woff2Buffer: Buffer;
}

/** Проверяет сигнатуру байтов шрифта и возвращает название формата или null. */
function detectFontFormat(buffer: Buffer): string | null {
  if (buffer.length < 4) return null;
  const header = buffer.subarray(0, 4).toString('hex').toLowerCase();
  for (const sig of FONT_SIGNATURES) {
    if (header === sig.hex) return sig.name;
  }
  return null;
}

/**
 * Обрабатывает буфер шрифта: проверяет формат, извлекает метаданные, конвертирует в WOFF2.
 * Выбрасывает HttpException-совместимую ошибку при проблемах.
 */
export async function processFont(buffer: Buffer, declared?: FontLicense): Promise<FontProcessResult> {
  if (buffer.length > FONT_MAX_BYTES) {
    throw Object.assign(new Error('Файл шрифта превышает максимальный размер 10 МБ (TS-26)'), {
      status: 400,
      code: 'FONT_TOO_LARGE',
    });
  }

  const format = detectFontFormat(buffer);
  if (!format) {
    throw Object.assign(new Error('Неподдерживаемый формат файла. Разрешены: TTF, OTF, WOFF, WOFF2'), {
      status: 400,
      code: 'FONT_INVALID_FORMAT',
    });
  }

  let font: ReturnType<typeof fontkit.create>;
  try {
    font = fontkit.create(buffer);
  } catch {
    throw Object.assign(new Error('Файл шрифта повреждён или не читается'), {
      status: 400,
      code: 'FONT_BROKEN',
    });
  }

  const family: string = font.familyName ?? 'Unknown';

  // Определяем вес и стиль из таблицы OS/2
  let weight = 400;
  let isItalic = false;
  try {
    const os2 = font['OS/2'] as
      | { usWeightClass?: number; fsSelection?: { italic?: boolean } }
      | undefined;
    if (os2?.usWeightClass) weight = os2.usWeightClass;
    if (os2?.fsSelection?.italic) isItalic = true;
  } catch {
    // Если таблица OS/2 недоступна — используем значения по умолчанию
  }

  const styleKey = isItalic ? `${weight}i` : `${weight}`;

  // Проверяем наличие кириллицы
  let hasCyrillic = false;
  try {
    const codepoints = font.characterSet;
    hasCyrillic = codepoints.some((cp) => cp >= CYRILLIC_START && cp <= CYRILLIC_END);
  } catch {
    // hasCyrillic остаётся false
  }

  // Метаданные: авторские права, производитель, код производителя, текст лицензии.
  const str = (v: unknown): string | null => (typeof v === 'string' && v.trim() ? v.trim() : null);
  let vendorId: string | null = null;
  try {
    vendorId = str((font['OS/2'] as { achVendID?: unknown } | undefined)?.achVendID);
  } catch {
    // таблицы нет — кода производителя нет
  }
  const copyright = str(font.copyright);
  const vendor = commercialVendor({ copyright, manufacturer: str(font.manufacturer), vendorId, licenseText: str(font.license) });
  if (declared === 'OFL' && vendor) {
    throw Object.assign(
      new Error(`В файле указан правообладатель «${vendor}» — это коммерческий шрифт, а не свободный. Выберите «Куплена веб-лицензия» или загрузите другой шрифт`),
      { status: 400, code: 'FONT_LICENSE_MISMATCH' },
    );
  }

  // Конвертируем в WOFF2
  let woff2Buffer: Buffer;
  try {
    woff2Buffer = await subsetFont(buffer, undefined, { keepAllGlyphs: true, targetFormat: 'woff2' });
  } catch {
    throw Object.assign(new Error('Не удалось преобразовать шрифт в формат WOFF2'), {
      status: 400,
      code: 'FONT_CONVERSION_FAILED',
    });
  }

  return { family, styleKey, hasCyrillic, woff2Buffer, copyright };
}
