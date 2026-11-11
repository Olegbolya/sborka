import { describe, expect, it } from 'vitest';
import { FULL, pull } from '../components/editor/MediaFramer';

describe('S-11 · рамка кадрирования', () => {
  it('S-11 · потянуть сторону: рамка меняется только по этой стороне и не выходит за файл', () => {
    expect(pull(FULL, 'w', 0.2, 0)).toEqual({ x: 0.2, y: 0, w: 0.8, h: 1 });
    expect(pull(FULL, 'e', -0.3, 0)).toEqual({ x: 0, y: 0, w: 0.7, h: 1 });
    expect(pull(FULL, 'n', 0, 0.25)).toEqual({ x: 0, y: 0.25, w: 1, h: 0.75 });
    expect(pull(FULL, 's', 0, 5)).toEqual({ x: 0, y: 0, w: 1, h: 1 });
  });

  it('S-11 · угол двигает две стороны сразу; рамка не тоньше 5 % файла', () => {
    expect(pull(FULL, 'se', -0.5, -0.5)).toEqual({ x: 0, y: 0, w: 0.5, h: 0.5 });
    expect(pull(FULL, 'nw', 2, 2)).toEqual({ x: 0.95, y: 0.95, w: 0.05, h: 0.05 });
  });

  it('S-11 · перенос рамки целиком держит её внутри файла', () => {
    const frame = { x: 0.2, y: 0.2, w: 0.5, h: 0.5 };
    expect(pull(frame, 'move', 1, 1)).toEqual({ x: 0.5, y: 0.5, w: 0.5, h: 0.5 });
    expect(pull(frame, 'move', -1, -1)).toEqual({ x: 0, y: 0, w: 0.5, h: 0.5 });
  });
});
