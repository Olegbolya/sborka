import { Writable } from 'node:stream';
import { describe, expect, it } from 'vitest';
import { createLogger, getRequestId, newRequestId, normalizeRequestId, runJobWithContext, runWithRequestId } from '../src/index.js';

const capture = () => {
  const lines: Record<string, unknown>[] = [];
  const stream = new Writable({
    write(chunk: Buffer, _enc, cb) {
      for (const l of chunk.toString().split('\n').filter(Boolean)) lines.push(JSON.parse(l) as Record<string, unknown>);
      cb();
    },
  });
  return { lines, stream };
};

describe('логгер', () => {
  it('пишет JSON с сервисом, версией и маскирует поля и сообщение', () => {
    const { lines, stream } = capture();
    const log = createLogger({ service: 'blokum-api', version: 'abc' }, stream);
    log.info({ phone: '+79991234567', token: 'secret-value' }, 'вход по номеру 89991234567, код 123456');
    const [rec] = lines;
    expect(rec).toMatchObject({ service: 'blokum-api', version: 'abc', level: 'info', token: '•••' });
    const raw = JSON.stringify(rec);
    expect(raw).not.toMatch(/9991234|secret-value|123456/);
    expect(rec?.msg).toContain('код •••');
  });

  it('добавляет id запроса внутри runWithRequestId, в том числе после await', async () => {
    const { lines, stream } = capture();
    const log = createLogger({ service: 'blokum-worker' }, stream);
    await runWithRequestId('req-12345678', async () => {
      await new Promise((r) => setTimeout(r, 5));
      log.warn('после ожидания');
    });
    log.info('вне запроса');
    expect(lines[0]).toMatchObject({ requestId: 'req-12345678', level: 'warn' });
    expect(lines[1]?.requestId).toBeUndefined();
  });

  it('ошибки логируются с маскированным стеком', () => {
    const { lines, stream } = capture();
    const log = createLogger({ service: 'blokum-api' }, stream);
    log.error({ err: new Error('падение для a.user@mail.ru') }, 'сбой');
    expect(JSON.stringify(lines[0])).not.toContain('a.user@');
  });
});

describe('id запроса', () => {
  it('принимает безопасные id и отклоняет опасные', () => {
    expect(normalizeRequestId('abc-123_DEF.456')).toBe('abc-123_DEF.456');
    expect(normalizeRequestId(['abcdefgh1', 'x'])).toBe('abcdefgh1');
    for (const bad of [undefined, null, '', 'short', 'a'.repeat(65), 'evil\nlog', 'имя-запроса-1']) {
      expect(normalizeRequestId(bad)).toBeUndefined();
    }
  });

  it('новый id — UUID и проходит проверку', () => {
    const id = newRequestId();
    expect(id).toMatch(/^[0-9a-f-]{36}$/);
    expect(normalizeRequestId(id)).toBe(id);
  });

  it('фоновая задача продолжает id запроса, который её создал', () => {
    expect(runJobWithContext({ data: { requestId: 'from-request-1' } }, getRequestId)).toBe('from-request-1');
    const generated = runJobWithContext({ data: {} }, getRequestId);
    expect(generated).toMatch(/^[0-9a-f-]{36}$/);
    expect(runJobWithContext({ data: { requestId: 'bad\nid' } }, getRequestId)).not.toBe('bad\nid');
    expect(runJobWithContext({ data: null }, getRequestId)).toBeDefined();
  });
});
