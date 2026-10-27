import { type ProjectDocument } from '@blokum/schema';

/** E-17: pause after the last change before the document goes to the server. */
export const AUTOSAVE_DELAY_MS = 1000;
/** After a failed attempt without network the next one is tried after this pause (and at once when the network is back). */
export const RETRY_DELAY_MS = 5000;
/** A request that must outlive the page (`keepalive`) may carry about 64 kB. */
export const KEEPALIVE_LIMIT_BYTES = 60_000;

export type SaveStatus = 'saved' | 'saving' | 'offline' | 'conflict' | 'error';

export interface SaveView {
  status: SaveStatus;
  /** Text for the screen in Russian (E-17). */
  text: string;
  /** Revision the server has now (what the next save is based on). */
  revision: number;
}

export interface QueuedDraft {
  document: ProjectDocument;
  /** The revision the document was based on when it was queued. */
  baseRevision: number;
}

/** Local queue of unsent changes (IndexedDB in the browser). */
export interface DraftQueue {
  put(projectId: string, draft: QueuedDraft): Promise<void>;
  get(projectId: string): Promise<QueuedDraft | null>;
  remove(projectId: string): Promise<void>;
}

/** What a failed request tells the saver. */
export type SaveFailure = { kind: 'network' } | { kind: 'conflict'; currentRevision: number } | { kind: 'auth' } | { kind: 'rejected'; message: string };

export interface SaverDeps {
  /** One `PUT /projects/:id/draft`; resolves with the new revision or rejects with a `SaveError`. */
  send(projectId: string, document: ProjectDocument, ifMatch: string, keepalive: boolean): Promise<number>;
  queue: DraftQueue;
  online(): boolean;
  setTimer(fn: () => void, ms: number): unknown;
  clearTimer(handle: unknown): void;
  onAuthLost(): void;
}

export const STATUS_TEXT: Record<SaveStatus, string> = {
  saved: 'Сохранено',
  saving: 'Сохраняю…',
  offline: 'Нет сети — изменения сохранятся',
  conflict: 'Сборку изменили в другом месте',
  error: 'Не удалось сохранить',
};

/** What `send` rejects with: carries the reason as data. */
export class SaveError extends Error {
  constructor(readonly failure: SaveFailure) {
    super(failure.kind);
    this.name = 'SaveError';
  }
}

/**
 * P3.2 · E-17/E-18: sends changes of the document to the server one second after the last change and when the page
 * is left, keeps them in a local queue while there is no network, and stops on a conflict until the person chooses.
 */
export class Saver {
  private latest: ProjectDocument | null = null;
  private dirty = false;
  private inFlight: Promise<void> | null = null;
  private timer: unknown = null;
  private overwrite = false;
  private view: SaveView;
  private readonly listeners = new Set<(v: SaveView) => void>();

  constructor(
    private readonly projectId: string,
    private readonly deps: SaverDeps,
    revision: number,
  ) {
    this.view = { status: 'saved', text: STATUS_TEXT.saved, revision };
  }

  get state(): SaveView {
    return this.view;
  }

  subscribe = (fn: (v: SaveView) => void): (() => void) => {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  };

  private set(status: SaveStatus, text = STATUS_TEXT[status], revision = this.view.revision): void {
    this.view = { status, text, revision };
    for (const l of this.listeners) l(this.view);
  }

  /** The document changed: schedule saving. */
  changed(doc: ProjectDocument): void {
    this.latest = doc;
    this.dirty = true;
    if (this.view.status === 'conflict') return; // waits for the choice; the newest document is kept
    if (this.view.status !== 'offline') this.set('saving');
    this.arm(AUTOSAVE_DELAY_MS);
  }

  private arm(ms: number): void {
    if (this.timer !== null) this.deps.clearTimer(this.timer);
    this.timer = this.deps.setTimer(() => {
      this.timer = null;
      void this.flush();
    }, ms);
  }

  /** Sends what is pending now (also before «Опубликовать» and when leaving). Resolves when nothing is left to send or it cannot be sent. */
  async flush(): Promise<void> {
    if (this.timer !== null) {
      this.deps.clearTimer(this.timer);
      this.timer = null;
    }
    while (this.inFlight) await this.inFlight;
    if (!this.dirty || !this.latest || this.view.status === 'conflict') return;
    this.inFlight = this.attempt();
    try {
      await this.inFlight;
    } finally {
      this.inFlight = null;
    }
    if (this.dirty && this.view.status === 'saving') await this.flush();
  }

  private async attempt(): Promise<void> {
    const doc = this.latest!;
    if (!this.deps.online()) {
      await this.park(doc);
      return;
    }
    this.set('saving');
    const ifMatch = this.overwrite ? '*' : String(this.view.revision);
    try {
      const revision = await this.deps.send(this.projectId, doc, ifMatch, false);
      this.overwrite = false;
      if (this.latest === doc) {
        this.dirty = false;
        await this.deps.queue.remove(this.projectId).catch(() => undefined);
        this.set('saved', STATUS_TEXT.saved, revision);
      } else {
        this.set('saving', STATUS_TEXT.saving, revision); // changed while the request was going: the next round sends it
      }
    } catch (e) {
      await this.failed(e, doc);
    }
  }

  private async failed(e: unknown, doc: ProjectDocument): Promise<void> {
    const failure: SaveFailure = e instanceof SaveError ? e.failure : { kind: 'network' };
    if (failure.kind === 'network') {
      await this.park(doc);
    } else if (failure.kind === 'conflict') {
      await this.deps.queue.put(this.projectId, { document: this.latest ?? doc, baseRevision: this.view.revision }).catch(() => undefined);
      this.set('conflict', STATUS_TEXT.conflict, failure.currentRevision);
    } else if (failure.kind === 'auth') {
      this.deps.onAuthLost();
      this.set('error', 'Войдите заново — изменения сохранены на этом устройстве');
      await this.deps.queue.put(this.projectId, { document: this.latest ?? doc, baseRevision: this.view.revision }).catch(() => undefined);
    } else {
      this.set('error', `${STATUS_TEXT.error}: ${failure.message}`);
    }
  }

  /** No network: keep the document in the local queue and try again later. */
  private async park(doc: ProjectDocument): Promise<void> {
    await this.deps.queue.put(this.projectId, { document: doc, baseRevision: this.view.revision }).catch(() => undefined);
    this.set('offline');
    this.arm(RETRY_DELAY_MS);
  }

  /** The browser reports that the network is back. */
  networkBack(): void {
    if (this.view.status === 'offline' && this.dirty) {
      this.set('saving');
      this.arm(0);
    }
  }

  networkLost(): void {
    if (this.dirty && this.view.status !== 'conflict') this.set('offline');
  }

  /**
   * The page is being left (E-17): what is pending goes to the local queue at once and, if it is small enough,
   * to the server with a request that outlives the page.
   */
  leaving(): void {
    if (!this.dirty || !this.latest || this.view.status === 'conflict') return;
    const doc = this.latest;
    void this.deps.queue.put(this.projectId, { document: doc, baseRevision: this.view.revision }).catch(() => undefined);
    if (this.deps.online() && JSON.stringify(doc).length < KEEPALIVE_LIMIT_BYTES) {
      void this.deps.send(this.projectId, doc, this.overwrite ? '*' : String(this.view.revision), true).catch(() => undefined);
    }
  }

  /** E-18 «Перезаписать»: the next save replaces whatever the server has. */
  async overwriteServer(): Promise<void> {
    if (this.view.status !== 'conflict') return;
    this.overwrite = true;
    this.set('saving');
    await this.flush();
  }

  /** E-18 «Загрузить свежую»: the local changes are dropped, the caller shows the server's document. */
  async acceptServerVersion(revision: number): Promise<void> {
    this.latest = null;
    this.dirty = false;
    this.overwrite = false;
    await this.deps.queue.remove(this.projectId).catch(() => undefined);
    this.set('saved', STATUS_TEXT.saved, revision);
  }

  /** Local changes found in the queue after loading the page: they are saved again on top of their base revision. */
  restore(draft: QueuedDraft): void {
    this.view = { ...this.view, revision: draft.baseRevision };
    this.changed(draft.document);
  }

  /** Server revision known after loading (for `restore` when the base is older, the save ends in a conflict). */
  dispose(): void {
    if (this.timer !== null) this.deps.clearTimer(this.timer);
    this.timer = null;
    this.listeners.clear();
  }
}
