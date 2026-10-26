/** Address of the API from the browser: the same origin, nginx / Next.js rewrites send `/api/*` to the API. */
const API_BASE = '/api/v1';

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

/** Reads the error the API sends (`{error:{code,message}}` or Nest's `{message}`); the text is already Russian. */
async function toApiError(res: Response): Promise<ApiError> {
  let code = 'UNKNOWN';
  let message = 'Что-то пошло не так. Попробуйте ещё раз.';
  try {
    const body = (await res.json()) as { error?: { code?: string; message?: string }; message?: unknown };
    if (body.error?.code) code = body.error.code;
    if (body.error?.message) message = body.error.message;
    else if (typeof body.message === 'string' && /[а-яё]/i.test(body.message)) message = body.message;
  } catch {
    // The body is not JSON; keep the general text.
  }
  if (res.status === 401) message = 'Войдите, чтобы продолжить.';
  return new ApiError(res.status, code, message);
}

/**
 * Call to the API from a page. The cookie travels with the request (same origin); the browser adds `Origin`
 * to mutating requests, which the server's CSRF check requires. Throws `ApiError` on any non-2xx answer.
 */
export async function api<T>(path: string, init: { method?: string; body?: unknown } = {}): Promise<T> {
  const res = await apiRaw(path, init);
  return (await res.json()) as T;
}

export async function apiRaw(path: string, init: { method?: string; body?: unknown } = {}): Promise<Response> {
  const hasBody = init.body !== undefined;
  const res = await fetch(`${API_BASE}${path}`, {
    method: init.method ?? 'GET',
    credentials: 'same-origin',
    headers: hasBody ? { 'content-type': 'application/json', accept: 'application/json' } : { accept: 'application/json' },
    ...(hasBody ? { body: JSON.stringify(init.body) } : {}),
  });
  if (!res.ok) throw await toApiError(res);
  return res;
}

export function isApiError(e: unknown): e is ApiError {
  return e instanceof ApiError;
}

/** Text for the screen from any thrown value. */
export function errorText(e: unknown): string {
  return isApiError(e) ? e.message : 'Не удалось связаться с сервером. Проверьте соединение и повторите.';
}
