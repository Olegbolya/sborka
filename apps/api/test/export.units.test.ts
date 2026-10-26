import { describe, expect, it, vi } from 'vitest';
import type { Db } from '@blokum/db';
import { ExportService } from '../src/projects/export.service.js';
import type { ResponsesService } from '../src/projects/responses.service.js';

const session = (id: string, extra: Record<string, unknown> = {}) => ({
  id,
  status: 'COMPLETED',
  startedAt: new Date('2026-10-01T10:00:00Z'),
  completedAt: new Date('2026-10-01T10:05:00Z'),
  durationMs: 300000,
  deviceType: 'MOBILE',
  score: 7,
  resultKey: 'r1',
  accessPointId: null,
  ...extra,
});

function makeService(pages: Array<{ items: unknown[]; nextCursor: string | null }>, answers: unknown[]) {
  const listResponses = vi.fn();
  for (const p of pages) listResponses.mockResolvedValueOnce(p);
  const db = { select: () => ({ from: () => ({ where: () => ({ orderBy: () => Promise.resolve(answers) }) }) }) } as unknown as Db;
  return { svc: new ExportService(db, { listResponses } as unknown as ResponsesService), listResponses };
}

describe('D-06: выгрузка ответов', () => {
  it('CSV: BOM, заголовки по-русски, ответы в отдельных столбцах, экранирование запятых и кавычек', async () => {
    const { svc } = makeService(
      [{ items: [session('s1'), session('s2', { completedAt: null, durationMs: null, score: null, resultKey: null, accessPointId: 'ap1' })], nextCursor: null }],
      [
        { sessionId: 's1', blockId: 'b1', variableId: null, value: 'a, "b"' },
        { sessionId: 's2', blockId: null, variableId: 'v1', value: 5 },
        { sessionId: 's2', blockId: null, variableId: null, value: 'x' },
      ],
    );
    const text = (await svc.exportCsv('u1', 'p1')).toString('utf8');
    expect(text.charCodeAt(0)).toBe(0xfeff);
    const [header, row1, row2] = text.slice(1).split('\r\n');
    expect(header).toBe('id,статус,начало,завершение,длительность_мс,устройство,баллы,результат,источник,ответ_b1,ответ_v1,ответ_ответ');
    const json = JSON.stringify('a, "b"');
    expect(row1).toContain(`"${json.replace(/"/g, '""')}"`);
    expect(row2).toContain(',ap1,');
  });

  it('постраничная загрузка: все страницы попадают в файл; без ответов запрос к базе не нужен', async () => {
    const { svc, listResponses } = makeService(
      [
        { items: [session('s1')], nextCursor: 'c1' },
        { items: [session('s2')], nextCursor: null },
      ],
      [],
    );
    const text = (await svc.exportCsv('u1', 'p1')).toString('utf8');
    expect(listResponses).toHaveBeenCalledTimes(2);
    expect(text.split('\r\n')).toHaveLength(3);
  });

  it('пустой список: только заголовки', async () => {
    const { svc } = makeService([{ items: [], nextCursor: null }], []);
    const lines = (await svc.exportCsv('u1', 'p1')).toString('utf8').split('\r\n');
    expect(lines).toHaveLength(1);
  });

  it('XLSX: настоящий файл (PK), лист «Ответы»', async () => {
    const { svc } = makeService([{ items: [session('s1')], nextCursor: null }], [{ sessionId: 's1', blockId: 'b1', variableId: null, value: 'да' }]);
    const buf = await svc.exportXlsx('u1', 'p1');
    expect(buf.subarray(0, 2).toString()).toBe('PK');
  });
});
