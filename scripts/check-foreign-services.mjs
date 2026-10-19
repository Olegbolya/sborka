#!/usr/bin/env node
// Blocks foreign services that would receive users' personal data (cross-border transfer, 152-FZ art. 12)
// and foreign auth providers (149-FZ art. 10 as amended by 406-FZ). See docs/05-LEGAL.md §2.3, §2.5.
import { readdirSync, statSync, readFileSync, existsSync } from 'node:fs';
import { join, relative, extname, basename } from 'node:path';
import { ROOT } from './lib/plan.mjs';

const SCAN_DIRS = ['apps', 'packages', 'infra'];
const SKIP_DIRS = new Set(['node_modules', 'dist', '.next', 'coverage', 'build', '.turbo']);
const EXT = new Set(['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs', '.json', '.css', '.html', '.conf', '.sh', '.yml', '.yaml', '.env', '.example']);

const DOMAINS = [
  'fonts.googleapis.com', 'fonts.gstatic.com', 'googletagmanager.com', 'google-analytics.com', 'recaptcha.net',
  'google.com/recaptcha', 'gstatic.com', 'accounts.google.com', 'googleapis.com', 'appleid.apple.com',
  'workers.dev', 'cloudflare.com', 'cloudflareinsights.com', 'unpkg.com', 'cdn.jsdelivr.net',
  'resend.com', 'sendgrid', 'mailchimp', 'mailgun', 'stripe.com', 'sentry.io', 'vercel-insights', 'vercel.live',
  'amazonaws.com', 'cloudfront.net', 'firebaseio.com', 'segment.io', 'mixpanel.com', 'hotjar.com', 'intercom.io',
];
const IMPORTS = ['next/font/google', 'next-auth/providers/google', 'next-auth/providers/apple', '@react-oauth/google'];
const PACKAGES = [/^resend$/, /^@sendgrid\//, /^@mailchimp\//, /^mailgun/, /^stripe$/, /^@stripe\//, /^@sentry\//, /^@vercel\/(analytics|speed-insights)$/, /^firebase/, /^@google-cloud\//, /^@react-oauth\/google$/, /^react-google-recaptcha/];

function walk(dir, out) {
  if (!existsSync(dir)) return;
  for (const name of readdirSync(dir)) {
    if (SKIP_DIRS.has(name)) continue;
    const full = join(dir, name);
    const st = statSync(full);
    if (st.isDirectory()) walk(full, out);
    else if (EXT.has(extname(name)) || name.startsWith('.env')) out.push(full);
  }
}

const files = [];
for (const d of SCAN_DIRS) walk(join(ROOT, d), files);
if (existsSync(join(ROOT, 'package.json'))) files.push(join(ROOT, 'package.json'));

const problems = [];
for (const full of files) {
  const rel = relative(ROOT, full).split('\\').join('/');
  const text = readFileSync(full, 'utf8');
  if (basename(full) === 'package.json') {
    const pkg = JSON.parse(text);
    for (const dep of Object.keys({ ...pkg.dependencies, ...pkg.devDependencies, ...pkg.optionalDependencies })) {
      if (PACKAGES.some((re) => re.test(dep))) problems.push(`${rel}: зависимость «${dep}» — иностранный сервис`);
    }
  }
  text.split('\n').forEach((line, i) => {
    for (const d of DOMAINS) if (line.includes(d)) problems.push(`${rel}:${i + 1}: обращение к «${d}»`);
    for (const imp of IMPORTS) if (line.includes(imp)) problems.push(`${rel}:${i + 1}: импорт «${imp}»`);
  });
}

if (problems.length) {
  console.error(`check-foreign-services: найдено ${problems.length}\n- ${problems.join('\n- ')}\n\nИспользуй российский сервис через интерфейс из docs/02-ARCHITECTURE.md §1 (шрифты — локально через next/font/local).`);
  process.exit(1);
}
console.log(`check-foreign-services: ок (${files.length} файлов)`);
