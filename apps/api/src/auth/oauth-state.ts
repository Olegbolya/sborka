const STATE_TTL_MS = 10 * 60 * 1000; // 10 minutes

export interface OAuthStateData {
  provider: string;
  codeVerifier: string;
  redirectUri: string;
}

export interface OAuthStateStore {
  save(state: string, data: OAuthStateData): Promise<void>;
  get(state: string): Promise<OAuthStateData | null>;
  delete(state: string): Promise<void>;
}

/** In-process store for OAuth states. Suitable for single-instance dev/test. */
export class InMemoryOAuthStateStore implements OAuthStateStore {
  private readonly states = new Map<string, { data: OAuthStateData; expiresAt: number }>();

  save(state: string, data: OAuthStateData): Promise<void> {
    this.states.set(state, { data, expiresAt: Date.now() + STATE_TTL_MS });
    this.evictExpired();
    return Promise.resolve();
  }

  get(state: string): Promise<OAuthStateData | null> {
    const entry = this.states.get(state);
    if (!entry || entry.expiresAt < Date.now()) {
      this.states.delete(state);
      return Promise.resolve(null);
    }
    return Promise.resolve(entry.data);
  }

  delete(state: string): Promise<void> {
    this.states.delete(state);
    return Promise.resolve();
  }

  private evictExpired(): void {
    const now = Date.now();
    for (const [k, v] of this.states) {
      if (v.expiresAt < now) this.states.delete(k);
    }
  }
}
