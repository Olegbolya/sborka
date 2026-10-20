/**
 * Masking of personal data and secrets in logs and alerts (docs/02-ARCHITECTURE.md §8 п. 7, §9).
 * Applied to every log record and every alert text, so a careless `logger.info({ user })` does not
 * leak phones, e-mails, card numbers, one-time codes or tokens.
 */
export const MASK = '•••';

const SECRET_KEY = /pass(word|wd)?|secret|token|authorization|cookie|api[-_]?key|private[-_]?key|otp|smscode|verificationcode|codehash|totp/i;

const luhnOk = (digits: string): boolean => {
  let sum = 0;
  for (let i = 0; i < digits.length; i++) {
    let d = Number(digits[digits.length - 1 - i]);
    if (i % 2 === 1) {
      d *= 2;
      if (d > 9) d -= 9;
    }
    sum += d;
  }
  return sum % 10 === 0;
};

const RULES: Array<[RegExp, (m: string, ...g: string[]) => string]> = [
  // Authorization: Bearer <token>
  [/\b(Bearer|Basic)\s+[A-Za-z0-9._~+/=-]+/g, (_m, kind) => `${kind} ${MASK}`],
  // Secrets in query strings and key=value pairs
  [/([?&;\s](?:token|code|key|secret|sig|signature|password|pass|otp|access_token|refresh_token)=)[^&\s"';]+/gi, (_m, p) => `${p}${MASK}`],
  // One-time codes next to the word «код»/«code»
  [/((?:код|code)[^\p{L}\d]{0,3})\d{4,8}\b/giu, (_m, p) => `${p}${MASK}`],
  // Card numbers: 13–19 digits, optionally grouped by spaces or dashes, valid by Luhn
  [
    /\b\d(?:[ -]?\d){12,18}\b/g,
    (m) => {
      const digits = m.replace(/\D/g, '');
      return luhnOk(digits) ? `карта ${MASK}${digits.slice(-4)}` : m;
    },
  ],
  // Russian phone numbers: +7 / 8 and 10 digits with any separators
  [/(?:\+7|\b8)[\s()-]*\d{3}[\s()-]*\d{3}[\s-]*\d{2}[\s-]*(\d{2})\b/g, (_m, last) => `+7${MASK}${last}`],
  // Any other E.164 number
  [/\+\d{10,14}\b/g, (m) => `+${MASK}${m.slice(-2)}`],
  // E-mail: first character and the domain stay
  [/([A-Za-z0-9])[A-Za-z0-9._%+-]*@([A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,})/g, (_m, first, domain) => `${first}${MASK}@${domain}`],
  // Long hex strings (tokens, session ids, hashes)
  [/\b[a-f0-9]{32,}\b/gi, () => MASK],
];

/** Masks personal data and secrets inside free text. */
export function maskString(text: string): string {
  let out = text;
  for (const [re, fn] of RULES) out = out.replace(re, fn);
  return out;
}

/** Deep copy of a value with secret keys hidden and strings masked. Cycles and depth > 8 are cut. */
export function maskValue(value: unknown, depth = 0, seen: WeakSet<object> = new WeakSet()): unknown {
  if (typeof value === 'string') return maskString(value);
  if (value === null || typeof value !== 'object') return value;
  if (depth > 8) return '[глубоко]';
  if (seen.has(value)) return '[цикл]';
  seen.add(value);
  if (value instanceof Date) return value;
  if (value instanceof Error) {
    const err: Record<string, unknown> = { type: value.name, message: maskString(value.message) };
    if (value.stack) err.stack = maskString(value.stack);
    const code = (value as { code?: unknown }).code;
    if (code !== undefined) err.code = code;
    return err;
  }
  if (Array.isArray(value)) return value.map((v) => maskValue(v, depth + 1, seen));
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(value)) {
    out[k] = SECRET_KEY.test(k) && v !== null && v !== undefined && v !== '' ? MASK : maskValue(v, depth + 1, seen);
  }
  return out;
}
