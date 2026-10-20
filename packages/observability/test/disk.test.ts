import { describe, expect, it } from 'vitest';
import { type Alert, Alerts, checkDisks, diskUsagePercent } from '../src/index.js';

const fakeStatfs = (usedPct: number) => () =>
  Promise.resolve({ blocks: 1000, bfree: 1000 - usedPct * 10, bavail: 1000 - usedPct * 10, bsize: 4096 });

describe('контроль диска', () => {
  it('считает занятое место как df', async () => {
    expect(await diskUsagePercent('/', fakeStatfs(37))).toBe(37);
    expect(await diskUsagePercent('/', () => Promise.resolve({ blocks: 100, bfree: 20, bavail: 10, bsize: 1 }))).toBe(88.9);
    expect(await diskUsagePercent('/', () => Promise.resolve({ blocks: 0, bfree: 0, bavail: 0, bsize: 1 }))).toBe(0);
  });

  it('больше 80 % — тревога, ниже — тишина', async () => {
    const sent: Alert[] = [];
    const alerts = new Alerts({ channels: [{ name: 't', send: (a) => (sent.push(a), Promise.resolve()) }] });
    const low = await checkDisks(['/srv/blokum'], alerts, { statfs: fakeStatfs(79) });
    expect(low[0]).toMatchObject({ usedPct: 79, alerted: false });
    const high = await checkDisks(['/srv/blokum'], alerts, { statfs: fakeStatfs(85) });
    expect(high[0]).toMatchObject({ usedPct: 85, alerted: true });
    expect(sent[0]).toMatchObject({ key: 'disk:/srv/blokum', severity: 'warning', title: 'Диск заполнен на 85 %' });
  });

  it('больше 95 % — критическая тревога', async () => {
    const sent: Alert[] = [];
    const alerts = new Alerts({ channels: [{ name: 't', send: (a) => (sent.push(a), Promise.resolve()) }] });
    await checkDisks(['/'], alerts, { statfs: fakeStatfs(97) });
    expect(sent[0]?.severity).toBe('critical');
  });

  it('настоящий раздел читается без ошибок', async () => {
    const pct = await diskUsagePercent('/');
    expect(pct).toBeGreaterThanOrEqual(0);
    expect(pct).toBeLessThanOrEqual(100);
  });
});
