import { type AnswerValue, type ScoreTotals } from '@blokum/engine';
import { ApiError } from '../api-browser';

/** What the player sends to the server for a passage, kept in a queue so that nothing is lost when the network is (PL-12). */
type Op =
  | { id: string; kind: 'answer'; body: { blockId: string; value: AnswerValue; clientEventId: string; clientTs: number; timeOnScreenMs: number } }
  | { id: string; kind: 'state'; body: Record<string, unknown> }
  | { id: string; kind: 'complete' };

export interface CompleteResult {
  totals: ScoreTotals;
  result: { key: string; screenId: string | null } | null;
}

export interface QueueStorage {
  read(): string | null;
  write(value: string): void;
}

export interface PlayTransport {
  /** Calls the API; throws `ApiError` for an answer with an error status and any other error for a lost network. */
  call<T>(method: 'POST' | 'PUT', path: string, body?: unknown): Promise<T>;
}

export interface PlayClientOptions {
  transport: PlayTransport;
  storage: QueueStorage;
  /** Waits before the next attempt after a failure (ms); the tests make it short. */
  retryDelays?: number[];
  /** A server verdict on an answer («сразу»). */
  onVerdict?: (blockId: string, verdict: { correct: boolean | null; score: number }) => void;
  /** The server refused an answer for good (not a network failure): the person is told. */
  onRejected?: (message: string) => void;
  /** «Сразу»: the verdict is asked for after each answer. */
  instantFeedback: boolean;
  /** Time source and timers are replaceable for tests. */
  now?: () => number;
  setTimer?: (fn: () => void, ms: number) => unknown;
  clearTimer?: (handle: unknown) => void;
}

const newId = (): string => (typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID().replace(/-/g, '').slice(0, 24) : `e${Math.random().toString(36).slice(2, 14)}${Date.now().toString(36)}`);

/**
 * PL-11, PL-12 · the player's channel to the server: answers and the state of a passage go through a queue that survives a
 * reload, repeats after a failure and is safe to repeat (each answer has its own event id and time).
 */
export class PlayClient {
  private sessionId: string | null = null;
  private queue: Op[] = [];
  private flushing = false;
  private attempt = 0;
  private timer: unknown = null;
  private waiting = new Map<string, { resolve: (r: CompleteResult) => void; reject: (e: unknown) => void }>();
  private readonly now: () => number;
  private readonly setTimer: (fn: () => void, ms: number) => unknown;
  private readonly clearTimer: (h: unknown) => void;
  private readonly delays: number[];

  constructor(private readonly o: PlayClientOptions) {
    this.now = o.now ?? Date.now;
    this.setTimer = o.setTimer ?? ((fn, ms) => setTimeout(fn, ms));
    this.clearTimer = o.clearTimer ?? ((h) => clearTimeout(h as ReturnType<typeof setTimeout>));
    this.delays = o.retryDelays ?? [2000, 5000, 10_000, 30_000];
  }

  /**
   * The session exists on the server: what the browser kept from before a reload goes first, then what was waiting for the
   * session. The storage is read now, because its place depends on the session.
   */
  attach(sessionId: string): void {
    this.sessionId = sessionId;
    try {
      const saved = this.o.storage.read();
      const kept = saved ? (JSON.parse(saved) as Op[]).filter((op) => op && typeof op.id === 'string') : [];
      const known = new Set(this.queue.map((op) => op.id));
      this.queue = [...kept.filter((op) => !known.has(op.id)), ...this.queue];
    } catch {
      // What was kept cannot be read: the passage goes on without it.
    }
    this.persist();
    void this.flush();
  }

  /** How many things are waiting to be sent. */
  get pending(): number {
    return this.queue.length;
  }

  private persist(): void {
    try {
      this.o.storage.write(JSON.stringify(this.queue));
    } catch {
      // The browser does not keep it: the queue lives until the page is closed.
    }
  }

  private enqueue(op: Op): void {
    this.queue.push(op);
    this.persist();
    void this.flush();
  }

  answer(blockId: string, value: AnswerValue, timeOnScreenMs: number): void {
    this.enqueue({ id: newId(), kind: 'answer', body: { blockId, value, clientEventId: newId(), clientTs: this.now(), timeOnScreenMs } });
  }

  /** Only the latest state matters: an older one still waiting is replaced. */
  state(body: Record<string, unknown>): void {
    this.queue = this.queue.filter((op) => op.kind !== 'state');
    this.enqueue({ id: newId(), kind: 'state', body });
  }

  /** The end: resolves when the server has answered, however long the network takes. */
  complete(): Promise<CompleteResult> {
    const existing = this.queue.find((op) => op.kind === 'complete');
    const id = existing?.id ?? newId();
    if (!existing) this.queue.push({ id, kind: 'complete' });
    this.persist();
    const done = new Promise<CompleteResult>((resolve, reject) => this.waiting.set(id, { resolve, reject }));
    void this.flush();
    return done;
  }

  /** A decision of the server about the next screen: needs the network now, there is no queue for it. */
  async branch(screenId: string): Promise<{ to: string | null }> {
    if (!this.sessionId) throw new Error('Прохождение ещё не началось');
    await this.flush();
    return this.o.transport.call('POST', `/play/sessions/${this.sessionId}/branch`, { screenId });
  }

  async flush(): Promise<void> {
    if (this.flushing || !this.sessionId) return;
    this.flushing = true;
    if (this.timer !== null) {
      this.clearTimer(this.timer);
      this.timer = null;
    }
    try {
      while (this.queue.length > 0) {
        const op = this.queue[0]!;
        try {
          await this.send(op);
          this.queue.shift();
          this.persist();
          this.attempt = 0;
        } catch (e) {
          // An answer of the server with an error status is final (the request itself is wrong); a lost network or a failing server is not.
          const final = e instanceof ApiError && e.status >= 400 && e.status < 500 && e.status !== 408 && e.status !== 429;
          if (final) {
            this.queue.shift();
            this.persist();
            this.waiting.get(op.id)?.reject(e);
            this.waiting.delete(op.id);
            if (op.kind === 'answer') this.o.onRejected?.(e.message);
            continue;
          }
          const delay = this.delays[Math.min(this.attempt, this.delays.length - 1)]!;
          this.attempt++;
          this.timer = this.setTimer(() => void this.flush(), delay);
          return;
        }
      }
    } finally {
      this.flushing = false;
    }
  }

  private async send(op: Op): Promise<void> {
    const base = `/play/sessions/${this.sessionId}`;
    if (op.kind === 'answer') {
      await this.o.transport.call('POST', `${base}/answers`, op.body);
      if (this.o.instantFeedback) {
        try {
          const verdict = await this.o.transport.call<{ correct: boolean | null; score: number }>('POST', `${base}/check`, { blockId: op.body.blockId });
          this.o.onVerdict?.(op.body.blockId, { correct: verdict.correct, score: verdict.score });
        } catch (e) {
          if (!(e instanceof ApiError)) throw e;
        }
      }
    } else if (op.kind === 'state') {
      await this.o.transport.call('PUT', `${base}/state`, op.body);
    } else {
      const res = await this.o.transport.call<{ score: number; max: number; correct: number; keyed: number; result: { key: string; screenId: string | null } | null }>('POST', `${base}/complete`);
      this.waiting.get(op.id)?.resolve({ totals: { score: res.score, max: res.max, correct: res.correct, keyed: res.keyed }, result: res.result });
      this.waiting.delete(op.id);
    }
  }

  dispose(): void {
    if (this.timer !== null) this.clearTimer(this.timer);
    this.timer = null;
  }
}
