import { describe, expect, it } from 'vitest';
import { cleanLottie, LottieError } from '../src/media/lottie.js';

const baseLottie = () => ({ v: '5.9.0', ip: 0, op: 60, fr: 25, w: 100, h: 100, layers: [] as unknown[], assets: [] as unknown[] });

describe('TS-25 · Lottie cleanup', () => {
  it('принимает корректный пустой Lottie', () => {
    const result = cleanLottie(baseLottie());
    expect(result['v']).toBe('5.9.0');
  });

  it('отклоняет файл без поля v или layers', () => {
    expect(() => cleanLottie({ notLottie: true })).toThrow(LottieError);
    expect(() => cleanLottie({ v: '5.9' })).toThrow(LottieError);
  });

  it('TS-25 · удаляет выражения (поле x) из слоёв', () => {
    const lottie = {
      ...baseLottie(),
      layers: [
        {
          nm: 'layer1',
          ty: 4,
          ks: {
            p: { a: 0, k: [0, 0, 0], x: 'var $bm_rt = [0, 0, 0];' },
            r: { a: 0, k: 0, x: 'var $bm_rt = 0;' },
          },
          shapes: [{ nm: 's', ty: 'gr', x: 'var $bm_rt = null;' }],
        },
      ],
    };
    const cleaned = cleanLottie(lottie);
    const layer = (cleaned['layers'] as Array<Record<string, unknown>>)[0]!;
    const ks = layer['ks'] as Record<string, Record<string, unknown>>;
    expect(ks['p']!['x']).toBeUndefined();
    expect(ks['r']!['x']).toBeUndefined();
    const shape = ((layer['shapes'] as Array<Record<string, unknown>>)[0])!;
    expect(shape['x']).toBeUndefined();
  });

  it('TS-25 · удаляет внешние URL из ассетов', () => {
    const lottie = {
      ...baseLottie(),
      assets: [
        { id: 'img0', u: 'https://cdn.example.com/images/', p: 'cat.png' },
        { id: 'img1', u: 'data:image/png;base64,abc', p: 'inline.png' },
      ],
    };
    const cleaned = cleanLottie(lottie);
    const assets = cleaned['assets'] as Array<Record<string, unknown>>;
    expect(assets[0]!['u']).toBe('');
    expect(assets[0]!['p']).toBe('cat.png'); // path kept, only u cleared
    expect(assets[1]!['u']).toBe('data:image/png;base64,abc'); // inline data kept
  });

  it('TS-25 · 301 слой → ошибка LOTTIE_TOO_MANY_LAYERS', () => {
    const lottie = {
      ...baseLottie(),
      layers: Array.from({ length: 301 }, (_, i) => ({ nm: `l${i}`, ty: 4 })),
    };
    expect(() => cleanLottie(lottie)).toThrow(LottieError);
    try { cleanLottie(lottie); } catch (e) {
      expect(e).toBeInstanceOf(LottieError);
      expect((e as LottieError).code).toBe('LOTTIE_TOO_MANY_LAYERS');
    }
  });

  it('TS-25 · 300 слоёв принимается', () => {
    const lottie = {
      ...baseLottie(),
      layers: Array.from({ length: 300 }, (_, i) => ({ nm: `l${i}`, ty: 4 })),
    };
    expect(() => cleanLottie(lottie)).not.toThrow();
  });

  it('TS-25 · вложенные выражения удаляются рекурсивно', () => {
    const lottie = {
      ...baseLottie(),
      layers: [{
        nm: 'deep',
        ty: 4,
        shapes: [{
          nm: 'g',
          ty: 'gr',
          it: [{ nm: 'p', ty: 'fl', x: 'should be removed' }],
        }],
      }],
    };
    const cleaned = cleanLottie(lottie);
    const shape = (((cleaned['layers'] as Array<Record<string, unknown>>)[0]!['shapes'] as Array<Record<string, unknown>>)[0]!['it'] as Array<Record<string, unknown>>)[0]!;
    expect(shape['x']).toBeUndefined();
  });
});
