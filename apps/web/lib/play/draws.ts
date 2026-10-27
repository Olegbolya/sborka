import { type PlayTransport } from './play-client';

type Outcome = { index: number } | { value: number };

/**
 * RN-01 · randomness that affects the result comes from the server: a draw is asked for and written down there before it is
 * used. The runtime asks for numbers at once, so a few are fetched ahead (one per wheel, a handful for the general stream);
 * the server hands them out in order, so none can be re-asked until a better one. When none is at hand (no network) the
 * runtime's own random is used and this is reported, so the creator sees that the draw was made on the device.
 */
export class ServerDraws {
  private sessionId: string | null = null;
  private readonly buffers = new Map<string, Outcome[]>();
  private readonly nextSeq = new Map<string, number>();
  private readonly busy = new Set<string>();
  private readonly watched = new Set<string>();

  constructor(
    private readonly transport: PlayTransport,
    private readonly ahead: Record<string, number>,
    private readonly onDeviceDraw: () => void,
  ) {}

  /** The session exists: what is watched is fetched. */
  attach(sessionId: string): void {
    this.sessionId = sessionId;
    for (const source of this.watched) void this.fill(source);
  }

  /** A source whose draws are needed (a wheel, or the general stream `main`). */
  watch(sourceId: string): void {
    this.watched.add(sourceId);
    if (this.sessionId) void this.fill(sourceId);
  }

  private async fill(sourceId: string): Promise<void> {
    if (!this.sessionId || this.busy.has(sourceId)) return;
    this.busy.add(sourceId);
    try {
      const want = this.ahead[sourceId] ?? this.ahead.default ?? 1;
      while ((this.buffers.get(sourceId)?.length ?? 0) < want) {
        const seq = this.nextSeq.get(sourceId) ?? 0;
        const res = await this.transport.call<{ outcome: Outcome }>('POST', `/play/sessions/${this.sessionId}/random`, { sourceId, seq });
        this.nextSeq.set(sourceId, seq + 1);
        this.buffers.set(sourceId, [...(this.buffers.get(sourceId) ?? []), res.outcome]);
      }
    } catch {
      // No network or a refusal: what is at hand is used; the next take tries again.
    } finally {
      this.busy.delete(sourceId);
    }
  }

  private take(sourceId: string): Outcome | undefined {
    const queue = this.buffers.get(sourceId) ?? [];
    const outcome = queue.shift();
    this.buffers.set(sourceId, queue);
    void this.fill(sourceId);
    if (!outcome) this.onDeviceDraw();
    return outcome;
  }

  /** The sector the server drew for a wheel, or `undefined` when none is at hand. */
  drawWheel = (blockId: string): number | undefined => {
    const outcome = this.take(blockId);
    return outcome && 'index' in outcome ? outcome.index : undefined;
  };

  /** A float for the results: the general stream, or the device's own when the stream is dry. */
  next = (): number => {
    const outcome = this.take('main');
    return outcome && 'value' in outcome ? outcome.value : Math.random();
  };
}
