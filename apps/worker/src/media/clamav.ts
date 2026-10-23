import { spawn } from 'node:child_process';

export interface ScanResult {
  isVirus: boolean;
  virusName: string | null;
}

/** TS-21: Scan a file with ClamAV. Returns { isVirus, virusName }. */
export async function scanFile(filePath: string): Promise<ScanResult> {
  const result = await runClam(filePath);
  return result;
}

/** Returns true if clamscan (or clamdscan) is available on PATH. */
export async function isClamAvailable(): Promise<boolean> {
  try {
    await runCommand('clamscan', ['--version']);
    return true;
  } catch {
    try {
      await runCommand('clamdscan', ['--version']);
      return true;
    } catch {
      return false;
    }
  }
}

async function runClam(filePath: string): Promise<ScanResult> {
  // Try clamdscan (daemon mode, faster) then clamscan (standalone).
  const cmds = ['clamdscan', 'clamscan'];
  let lastError: Error | null = null;
  for (const cmd of cmds) {
    try {
      const output = await runCommand(cmd, ['--no-summary', filePath]);
      const isVirus = output.includes('FOUND');
      let virusName: string | null = null;
      if (isVirus) {
        const m = /:\s+(.+)\s+FOUND/.exec(output);
        virusName = m?.[1] ?? 'unknown';
      }
      return { isVirus, virusName };
    } catch (e) {
      // Exit code 1 = virus found (that's not an error we re-throw).
      if (e instanceof ClamExitError && e.exitCode === 1) {
        const m = /:\s+(.+)\s+FOUND/.exec(e.stdout);
        return { isVirus: true, virusName: m?.[1] ?? 'unknown' };
      }
      lastError = e instanceof Error ? e : new Error(String(e));
    }
  }
  throw lastError ?? new Error('ClamAV не установлен');
}

class ClamExitError extends Error {
  constructor(public exitCode: number, public stdout: string) {
    super(`clamscan exited with code ${exitCode}`);
  }
}

function runCommand(cmd: string, args: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    const proc = spawn(cmd, args, { stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    proc.stdout?.on('data', (d: Buffer) => { stdout += d.toString(); });
    proc.stderr?.on('data', (d: Buffer) => { stderr += d.toString(); });
    proc.on('error', reject);
    proc.on('close', (code) => {
      if (code === 0) { resolve(stdout); return; }
      if (code !== null && code > 0) {
        reject(new ClamExitError(code, stdout + stderr));
      } else {
        reject(new Error(`${cmd} завершился без кода: ${stderr}`));
      }
    });
  });
}
