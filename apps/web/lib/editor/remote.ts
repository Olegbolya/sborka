import { type ProjectDocument } from '@blokum/schema';
import { ApiError, api, isApiError } from '../api-browser';
import { type DraftQueue, type QueuedDraft, SaveError, type SaveFailure, type SaverDeps } from './saver';

/** Everything the editor page needs from the server about one project. */
export interface LoadedProject {
  id: string;
  title: string;
  status: 'DRAFT' | 'PUBLISHED' | 'CLOSED';
  slug: string;
  document: ProjectDocument | null;
  /** Revision of the draft (`If-Match` of the next save). */
  draftVersionNumber: number | null;
}

export const loadProject = (id: string): Promise<LoadedProject> => api<LoadedProject>(`/projects/${encodeURIComponent(id)}`);

/** What a failed `PUT /draft` means for the saver. */
export function toSaveFailure(e: unknown): SaveFailure {
  if (!isApiError(e)) return { kind: 'network' };
  if (e.status === 401) return { kind: 'auth' };
  if (e.status === 409 && e.code === 'REVISION_CONFLICT') return { kind: 'conflict', currentRevision: e.currentRevision ?? 0 };
  if (e.status >= 500) return { kind: 'network' };
  return { kind: 'rejected', message: e.message };
}

export async function sendDraft(projectId: string, document: ProjectDocument, ifMatch: string, keepalive: boolean): Promise<number> {
  try {
    const res = await api<{ revision: number }>(`/projects/${encodeURIComponent(projectId)}/draft`, {
      method: 'PUT',
      body: { document },
      headers: { 'if-match': ifMatch },
      keepalive,
    });
    return res.revision;
  } catch (e) {
    throw new SaveError(toSaveFailure(e));
  }
}

const DB_NAME = 'blokum-editor';
const STORE = 'drafts';

/** Local queue in IndexedDB; when the browser forbids it (private window) the queue lives in memory only. */
export class IdbQueue implements DraftQueue {
  private readonly memory = new Map<string, QueuedDraft>();
  private db: Promise<IDBDatabase | null> | null = null;

  private open(): Promise<IDBDatabase | null> {
    this.db ??= new Promise((resolve) => {
      try {
        const req = indexedDB.open(DB_NAME, 1);
        req.onupgradeneeded = () => req.result.createObjectStore(STORE);
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => resolve(null);
        req.onblocked = () => resolve(null);
      } catch {
        resolve(null);
      }
    });
    return this.db;
  }

  private async run<T>(mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T>): Promise<T | undefined> {
    const db = await this.open();
    if (!db) return undefined;
    return new Promise((resolve) => {
      try {
        const req = fn(db.transaction(STORE, mode).objectStore(STORE));
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => resolve(undefined);
      } catch {
        resolve(undefined);
      }
    });
  }

  async put(projectId: string, draft: QueuedDraft): Promise<void> {
    this.memory.set(projectId, draft);
    await this.run('readwrite', (s) => s.put(draft, projectId));
  }

  async get(projectId: string): Promise<QueuedDraft | null> {
    const stored = (await this.run('readonly', (s) => s.get(projectId))) as QueuedDraft | undefined;
    return stored ?? this.memory.get(projectId) ?? null;
  }

  async remove(projectId: string): Promise<void> {
    this.memory.delete(projectId);
    await this.run('readwrite', (s) => s.delete(projectId));
  }
}

/** Real browser dependencies of the saver. */
export function browserSaverDeps(onAuthLost: () => void, queue: DraftQueue = new IdbQueue()): SaverDeps {
  return {
    send: sendDraft,
    queue,
    online: () => navigator.onLine,
    setTimer: (fn, ms) => setTimeout(fn, ms),
    clearTimer: (h) => clearTimeout(h as ReturnType<typeof setTimeout>),
    onAuthLost,
  };
}

export { ApiError };
