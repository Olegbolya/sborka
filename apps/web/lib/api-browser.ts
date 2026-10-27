/** Address of the API from the browser: the same origin, nginx / Next.js rewrites send `/api/*` to the API. */
const API_BASE = '/api/v1';

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    /** 409 of the draft: the revision the server has now. */
    readonly currentRevision?: number,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

/** Reads the error the API sends (`{error:{code,message}}` or Nest's `{message}`); the text is already Russian. */
async function toApiError(res: Response): Promise<ApiError> {
  let code = 'UNKNOWN';
  let message = 'Что-то пошло не так. Попробуйте ещё раз.';
  let revision: number | undefined;
  try {
    const body = (await res.json()) as { error?: { code?: string; message?: string; currentRevision?: number }; message?: unknown };
    revision = body.error?.currentRevision;
    if (body.error?.code) code = body.error.code;
    if (body.error?.message) message = body.error.message;
    else if (typeof body.message === 'string' && /[а-яё]/i.test(body.message)) message = body.message;
  } catch {
    // The body is not JSON; keep the general text.
  }
  if (res.status === 401) message = 'Войдите, чтобы продолжить.';
  return new ApiError(res.status, code, message, revision);
}

/**
 * Call to the API from a page. The cookie travels with the request (same origin); the browser adds `Origin`
 * to mutating requests, which the server's CSRF check requires. Throws `ApiError` on any non-2xx answer.
 */
export interface ApiInit {
  method?: string;
  body?: unknown;
  headers?: Record<string, string>;
  /** The request may finish after the page is closed (leaving the editor). */
  keepalive?: boolean;
}

export async function api<T>(path: string, init: ApiInit = {}): Promise<T> {
  const res = await apiRaw(path, init);
  // Some answers have no body (a status change): there is nothing to read.
  const text = await res.text();
  return (text ? JSON.parse(text) : undefined) as T;
}

export async function apiRaw(path: string, init: ApiInit = {}): Promise<Response> {
  const hasBody = init.body !== undefined;
  const res = await fetch(`${API_BASE}${path}`, {
    method: init.method ?? 'GET',
    credentials: 'same-origin',
    headers: { accept: 'application/json', ...(hasBody ? { 'content-type': 'application/json' } : {}), ...init.headers },
    ...(init.keepalive ? { keepalive: true } : {}),
    ...(hasBody ? { body: JSON.stringify(init.body) } : {}),
  });
  if (!res.ok) throw await toApiError(res);
  return res;
}

/** Sends a file (multipart): the browser sets the boundary itself, so there is no `content-type` here. */
export async function upload<T>(path: string, form: FormData): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, { method: 'POST', credentials: 'same-origin', headers: { accept: 'application/json' }, body: form });
  if (!res.ok) throw await toApiError(res);
  return (await res.json()) as T;
}

export function isApiError(e: unknown): e is ApiError {
  return e instanceof ApiError;
}

/** Text for the screen from any thrown value. */
export function errorText(e: unknown): string {
  return isApiError(e) ? e.message : 'Не удалось связаться с сервером. Проверьте соединение и повторите.';
}
