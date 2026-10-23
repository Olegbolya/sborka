import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { isClamAvailable, scanFile } from '../src/media/clamav.js';

const EICAR = 'X5O!P%@AP[4\\PZX54(P^)7CC)7}$EICAR-STANDARD-ANTIVIRUS-TEST-FILE!$H+H*';

let tmpDir = '';
let clamReady = false;

beforeAll(async () => {
  tmpDir = mkdtempSync(path.join(os.tmpdir(), 'clamtest-'));
  clamReady = await isClamAvailable();
});

afterAll(() => {
  try { if (tmpDir) rmSync(tmpDir, { recursive: true, force: true }); } catch { /* ignore */ }
});

describe('TS-21 · ClamAV scanner', () => {
  it('isClamAvailable возвращает boolean', () => {
    expect(typeof clamReady).toBe('boolean');
  });

  it.skipIf(!clamReady)('TS-21 · EICAR-файл → isVirus = true (вирус обнаружен)', async () => {
    const p = path.join(tmpDir, 'eicar.txt');
    writeFileSync(p, EICAR);
    const result = await scanFile(p);
    expect(result.isVirus).toBe(true);
    expect(result.virusName).toBeTruthy();
  });

  it.skipIf(!clamReady)('TS-21 · чистый файл → isVirus = false', async () => {
    const p = path.join(tmpDir, 'clean.txt');
    writeFileSync(p, 'Hello, world!');
    const result = await scanFile(p);
    expect(result.isVirus).toBe(false);
    expect(result.virusName).toBeNull();
  });
});
