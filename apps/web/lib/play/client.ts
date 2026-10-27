import { api, isApiError } from '../api-browser';
import { type PlayView } from './api';

/** What the browser keeps for the tab: the proof of the password and the confirmation of age (PL-08, PL-09). */
export interface Proof {
  unlock?: string;
  age18?: boolean;
}

const proofKey = (slug: string) => `bk:play:${slug}`;

export function readProof(slug: string): Proof {
  try {
    return JSON.parse(window.sessionStorage.getItem(proofKey(slug)) ?? '{}') as Proof;
  } catch {
    return {};
  }
}

export function saveProof(slug: string, proof: Proof): void {
  try {
    window.sessionStorage.setItem(proofKey(slug), JSON.stringify(proof));
  } catch {
    // The tab does not keep it (private mode): the participant is asked again on reload.
  }
}

/**
 * PL-10 · the token of this device: a random value kept by the browser, never computed from its properties (TS-12).
 * Without storage there is none and «одна попытка» cannot be told.
 */
export function deviceToken(): string | null {
  try {
    const key = 'bk:device';
    let token = window.localStorage.getItem(key);
    if (!token) {
      token = crypto.randomUUID();
      window.localStorage.setItem(key, token);
    }
    return token;
  } catch {
    return null;
  }
}

const proofHeaders = (proof: Proof): Record<string, string> => ({ ...(proof.unlock ? { 'x-play-unlock': proof.unlock } : {}), ...(proof.age18 ? { 'x-play-age': '1' } : {}) });

export const fetchView = (slug: string, proof: Proof): Promise<PlayView> => api(`/play/${encodeURIComponent(slug)}`, { headers: proofHeaders(proof) });

export const enter = (slug: string, body: { password?: string; age18?: boolean }): Promise<PlayView & { unlock?: string }> => api(`/play/${encodeURIComponent(slug)}/enter`, { method: 'POST', body });

export interface Started {
  sessionId: string;
  versionId: string;
}

/** PL-11 · the start of a passage; a refusal comes back as a state to show, not as a crash. */
export async function startSession(projectId: string, body: { source?: string | null; proof: Proof }): Promise<{ ok: true; session: Started } | { ok: false; code: string; message: string }> {
  try {
    const token = deviceToken();
    const session = await api<Started>(`/play/${encodeURIComponent(projectId)}/sessions`, {
      method: 'POST',
      body: { ...(token ? { deviceToken: token } : {}), ...(body.source ? { source: body.source } : {}), ...(body.proof.unlock ? { unlock: body.proof.unlock } : {}), ...(body.proof.age18 ? { age18: true } : {}) },
    });
    return { ok: true, session };
  } catch (e) {
    if (isApiError(e)) return { ok: false, code: e.code, message: e.message };
    throw e;
  }
}
