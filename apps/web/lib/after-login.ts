/**
 * TPL-05.2 · what to do right after the sign-in. A person who is not signed in presses «Собрать такую же»; the address to come back to
 * is kept in a short cookie (the sign-in goes through other sites, the tab's own storage would not survive it reliably).
 * Only the build page of a template, the copy page of a project (ADR-120) and the question form of the help page (AD-13) are accepted,
 * so nobody can make the sign-in lead elsewhere.
 */
const COOKIE = 'bk_after_login';
const ALLOWED = /^(\/t\/[a-z0-9-]{3,60}\/build(\?src=[a-z0-9._-]{1,40})?|\/copy\/[A-Za-z0-9_-]{3,60}|\/help#ask)$/;

export const isAfterLoginPath = (path: string): boolean => ALLOWED.test(path);

/** Keeps the address for half an hour. */
export function rememberAfterLogin(path: string): void {
  if (!isAfterLoginPath(path)) return;
  document.cookie = `${COOKIE}=${encodeURIComponent(path)}; Path=/; Max-Age=1800; SameSite=Lax`;
}

/** Returns the kept address once and forgets it; `null` when there is none or it is not an allowed one. */
export function takeAfterLogin(): string | null {
  const found = document.cookie.split(';').map((c) => c.trim().split('=')).find(([k]) => k === COOKIE);
  document.cookie = `${COOKIE}=; Path=/; Max-Age=0; SameSite=Lax`;
  if (!found?.[1]) return null;
  let path: string;
  try {
    path = decodeURIComponent(found[1]);
  } catch {
    return null;
  }
  return isAfterLoginPath(path) ? path : null;
}
