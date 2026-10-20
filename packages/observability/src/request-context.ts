import { AsyncLocalStorage } from 'node:async_hooks';
import { randomUUID } from 'node:crypto';

/** HTTP header carrying the request id through web → api → worker (docs/02-ARCHITECTURE.md §9). */
export const REQUEST_ID_HEADER = 'x-request-id';

interface RequestContext {
  requestId: string;
}

const storage = new AsyncLocalStorage<RequestContext>();

/** Accepts an incoming id only if it is short and safe to log; anything else is replaced. */
export function normalizeRequestId(raw: string | string[] | null | undefined): string | undefined {
  const v = Array.isArray(raw) ? raw[0] : raw;
  return v && /^[A-Za-z0-9._-]{8,64}$/.test(v) ? v : undefined;
}

export function newRequestId(): string {
  return randomUUID();
}

/** Runs `fn` with the given request id visible to every log line written inside it (incl. async work). */
export function runWithRequestId<T>(requestId: string, fn: () => T): T {
  return storage.run({ requestId }, fn);
}

export function getRequestId(): string | undefined {
  return storage.getStore()?.requestId;
}

/** Background jobs carry the id of the request that created them; jobs without one get a new id. */
export function runJobWithContext<T>(job: { data?: { requestId?: unknown } | null }, fn: () => T): T {
  const fromJob = typeof job.data?.requestId === 'string' ? normalizeRequestId(job.data.requestId) : undefined;
  return runWithRequestId(fromJob ?? newRequestId(), fn);
}
