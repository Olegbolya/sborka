/**
 * TS-05 · the reputation of links from the Yandex Safe Browsing service (Lookup API v4:
 * https://yandex.com/dev/safebrowsing/doc/en/concepts/lookup). Links go to it only when the publication is made, and only the
 * addresses of web links — never anything of the participants.
 */
export interface LinkThreat {
  url: string;
  threat: string;
}

export interface LinkReputation {
  /** The addresses that the service knows as dangerous. A failure of the service is an exception; the caller decides what to do. */
  check(urls: readonly string[]): Promise<LinkThreat[]>;
}

const ENDPOINT = 'https://sba.yandex.net/v4/threatMatches:find';

export class YandexSafeBrowsing implements LinkReputation {
  constructor(
    private readonly key: string,
    private readonly fetchImpl: typeof fetch = fetch,
    private readonly endpoint: string = ENDPOINT,
  ) {}

  async check(urls: readonly string[]): Promise<LinkThreat[]> {
    if (urls.length === 0) return [];
    const res = await this.fetchImpl(`${this.endpoint}?key=${encodeURIComponent(this.key)}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        client: { clientId: 'blokker', clientVersion: '1.0' },
        threatInfo: {
          threatTypes: ['MALWARE', 'SOCIAL_ENGINEERING', 'UNWANTED_SOFTWARE', 'POTENTIALLY_HARMFUL_APPLICATION'],
          platformTypes: ['ANY_PLATFORM'],
          threatEntryTypes: ['URL'],
          threatEntries: urls.map((url) => ({ url })),
        },
      }),
      signal: AbortSignal.timeout(5000),
    });
    if (!res.ok) throw new Error(`Safe Browsing answered ${res.status}`);
    // «If no checked URL is on the lists, the response body is empty.»
    const text = await res.text();
    if (text.trim() === '') return [];
    const body = JSON.parse(text) as { matches?: Array<{ threatType?: string; threat?: { url?: string } }> };
    return (body.matches ?? []).flatMap((m) => (m.threat?.url ? [{ url: m.threat.url, threat: m.threatType ?? 'UNKNOWN' }] : []));
  }
}
