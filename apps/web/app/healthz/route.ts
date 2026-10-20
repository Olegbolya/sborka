export const dynamic = 'force-dynamic';

/** Liveness probe of the web process for deploy checks (docs/03-PLAN.md, DoD п. 9). */
export function GET(): Response {
  return Response.json(
    { status: 'ok', service: 'blokum-web', version: process.env.APP_VERSION ?? 'dev', time: new Date().toISOString() },
    { headers: { 'cache-control': 'no-store' } },
  );
}
