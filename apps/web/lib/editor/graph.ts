/** L-02 · where the screens of the graph are drawn: columns by the number of steps from the first screen, rows inside a column. */
export interface GraphLayout {
  nodes: Map<string, { x: number; y: number; col: number; row: number }>;
  width: number;
  height: number;
}

const NODE_W = 150;
const NODE_H = 44;
const GAP_X = 70;
const GAP_Y = 36;
const PAD = 16;

export function layoutGraph(ids: readonly string[], edges: ReadonlyArray<readonly [string, string]>, start: string): GraphLayout {
  const out = new Map<string, string[]>(ids.map((id) => [id, []]));
  for (const [a, b] of edges) out.get(a)?.push(b);
  const depth = new Map<string, number>();
  const queue = [start];
  depth.set(start, 0);
  while (queue.length > 0) {
    const v = queue.shift()!;
    for (const w of out.get(v) ?? []) {
      if (!depth.has(w)) {
        depth.set(w, depth.get(v)! + 1);
        queue.push(w);
      }
    }
  }
  // Screens nobody reaches stand in their own column after the last one.
  const last = Math.max(0, ...depth.values());
  for (const id of ids) if (!depth.has(id)) depth.set(id, last + 1);
  const rows = new Map<number, number>();
  const nodes: GraphLayout['nodes'] = new Map();
  for (const id of ids) {
    const col = depth.get(id)!;
    const row = rows.get(col) ?? 0;
    rows.set(col, row + 1);
    nodes.set(id, { col, row, x: PAD + col * (NODE_W + GAP_X), y: PAD + row * (NODE_H + GAP_Y) });
  }
  const cols = Math.max(...[...nodes.values()].map((n) => n.col)) + 1;
  const tall = Math.max(...rows.values());
  return { nodes, width: PAD * 2 + cols * NODE_W + (cols - 1) * GAP_X, height: PAD * 2 + tall * NODE_H + (tall - 1) * GAP_Y + 40 };
}
