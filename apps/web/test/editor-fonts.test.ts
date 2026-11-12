import { describe, expect, it } from 'vitest';
import { faceDescriptors } from '../lib/editor/fonts';

describe('TH-04 · начертания шрифтов редактора', () => {
  it('TH-04: ключ «400» — обычное начертание, «700i» — вес 700 курсивом', () => {
    expect(faceDescriptors('400')).toEqual({ weight: '400', style: 'normal' });
    expect(faceDescriptors('700i')).toEqual({ weight: '700', style: 'italic' });
  });
});
