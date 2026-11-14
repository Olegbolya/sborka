/** Words that cannot be the address of a build: they are routes of the site or can be taken for the service itself (PL-01). */
export const RESERVED_SLUGS: ReadonlySet<string> = new Set([
  'admin', 'api', 'app', 'cabinet', 'editor', 'login', 'logout', 'register', 'signup', 'play', 'out', 'help', 'support', 'blokker', 'blokum',
  'sborka', 'www', 'mail', 'static', 'assets', 'media', 'files', 'tariffs', 'pricing', 'terms', 'privacy', 'legal', 'about', 'new', 'null',
  'undefined', 'test', 'demo', 'root', 'system', 'status', 'health', 'pay', 'payment', 'billing',
]);
