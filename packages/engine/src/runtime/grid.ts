/** Axis-aligned rectangle in artboard units. */
export interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

export const overlaps = (a: Box, b: Box): boolean => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;

/**
 * Uniform spatial hash for collision checks (TR-07): items are bucketed by cell, a query looks only at
 * the cells its box covers, so 200 moving copies stay far below the frame budget (SC-05).
 */
export class SpatialGrid<T extends { box: Box }> {
  private readonly cells = new Map<number, T[]>();

  constructor(private readonly cell = 64) {}

  private key(cx: number, cy: number): number {
    return (cx + 32768) * 65536 + (cy + 32768);
  }

  private range(b: Box): [number, number, number, number] {
    return [Math.floor(b.x / this.cell), Math.floor(b.y / this.cell), Math.floor((b.x + Math.max(b.w, 0)) / this.cell), Math.floor((b.y + Math.max(b.h, 0)) / this.cell)];
  }

  insert(item: T): void {
    const [x0, y0, x1, y1] = this.range(item.box);
    for (let cx = x0; cx <= x1; cx++) {
      for (let cy = y0; cy <= y1; cy++) {
        const k = this.key(cx, cy);
        const list = this.cells.get(k);
        if (list) list.push(item);
        else this.cells.set(k, [item]);
      }
    }
  }

  /** Items whose box overlaps `box`, each once. */
  query(box: Box): T[] {
    const [x0, y0, x1, y1] = this.range(box);
    const seen = new Set<T>();
    const out: T[] = [];
    for (let cx = x0; cx <= x1; cx++) {
      for (let cy = y0; cy <= y1; cy++) {
        for (const item of this.cells.get(this.key(cx, cy)) ?? []) {
          if (seen.has(item)) continue;
          seen.add(item);
          if (overlaps(item.box, box)) out.push(item);
        }
      }
    }
    return out;
  }
}
