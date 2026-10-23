/** TS-25: Clean a Lottie JSON — remove expressions, external URLs, validate schema/size. */

const MAX_LAYERS = 300;

export class LottieError extends Error {
  constructor(public readonly code: 'LOTTIE_INVALID' | 'LOTTIE_TOO_MANY_LAYERS', message: string) {
    super(message);
  }
}

/** Parse, validate and clean a Lottie JSON buffer. Returns cleaned JSON string. */
export function cleanLottie(raw: unknown): Record<string, unknown> {
  const obj = (typeof raw === 'string' ? (JSON.parse(raw) as Record<string, unknown>) : raw) as Record<string, unknown>;

  if (typeof obj['v'] !== 'string' || !Array.isArray(obj['layers'])) {
    throw new LottieError('LOTTIE_INVALID', 'Файл не является корректной анимацией Lottie');
  }

  const layers = obj['layers'] as unknown[];
  if (layers.length > MAX_LAYERS) {
    throw new LottieError('LOTTIE_TOO_MANY_LAYERS', `Lottie-файл содержит ${layers.length} слоёв — допустимо не более ${MAX_LAYERS} (TS-25)`);
  }

  // Strip expressions from all layers and shapes (recursive).
  stripExpressions(obj);

  // Remove external asset URLs (only keep embedded/inline data).
  if (Array.isArray(obj['assets'])) {
    for (const asset of obj['assets'] as Array<Record<string, unknown>>) {
      if (typeof asset['u'] === 'string' && !asset['u'].startsWith('data:')) {
        asset['u'] = '';
      }
      // Remove external path references.
      if (typeof asset['p'] === 'string' && asset['p'].startsWith('http')) {
        asset['p'] = '';
      }
    }
  }

  return obj;
}

/**
 * Recursively strip expression (`x`) fields from all Lottie value objects.
 * Expressions are JS code strings that `dotlottie-web` (ThorVG) ignores anyway,
 * but removing them ensures no JS payload is stored (TS-25).
 */
function stripExpressions(node: unknown): void {
  if (node === null || typeof node !== 'object') return;
  if (Array.isArray(node)) {
    for (const item of node) stripExpressions(item);
    return;
  }
  const obj = node as Record<string, unknown>;
  // `x` is the Lottie expression field on keyframe value objects.
  delete obj['x'];
  for (const val of Object.values(obj)) stripExpressions(val);
}
