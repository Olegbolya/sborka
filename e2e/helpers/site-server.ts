import { type ChildProcess, spawn } from 'node:child_process';

/** A second copy of the site (the same build) with its own environment: for checks that need a setting the main server has not. */
export async function startSite(offset: number, env: Record<string, string>): Promise<{ origin: string; stop: () => void }> {
  const port = Number(process.env.E2E_WEB_PORT ?? 3110) + offset;
  const server: ChildProcess = spawn('pnpm', ['--filter', '@blokum/web', 'exec', 'next', 'start', '--port', String(port), '--hostname', '127.0.0.1'], {
    env: { ...process.env, NEXT_TELEMETRY_DISABLED: '1', API_PORT: process.env.API_PORT ?? '3100', ...env },
    stdio: 'ignore',
  });
  const deadline = Date.now() + 60_000;
  for (;;) {
    try {
      if ((await fetch(`http://127.0.0.1:${port}/healthz`)).ok) break;
    } catch {
      // not up yet
    }
    if (Date.now() > deadline) throw new Error('копия сайта не запустилась');
    await new Promise((r) => setTimeout(r, 500));
  }
  return { origin: `http://127.0.0.1:${port}`, stop: () => void server.kill('SIGTERM') };
}
