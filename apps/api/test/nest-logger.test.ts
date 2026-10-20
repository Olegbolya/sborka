import { describe, expect, it, vi } from 'vitest';
import { NestPinoLogger } from '../src/observability/nest-logger.js';

describe('журнал NestJS идёт в общий логгер', () => {
  it('каждый уровень Nest попадает в соответствующий уровень pino с контекстом', () => {
    const pino = { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn(), trace: vi.fn() };
    const log = new NestPinoLogger(pino as never);
    log.log('старт', 'NestApplication');
    log.error('падение', 'stack', 'ExceptionsHandler');
    log.warn('внимание', 'Ctx');
    log.debug('отладка', 'Ctx');
    log.verbose('подробно', 'Ctx');
    expect(pino.info).toHaveBeenCalledWith({ context: 'NestApplication' }, 'старт');
    expect(pino.error).toHaveBeenCalledWith({ context: 'ExceptionsHandler', trace: 'stack' }, 'падение');
    expect(pino.warn).toHaveBeenCalledWith({ context: 'Ctx' }, 'внимание');
    expect(pino.debug).toHaveBeenCalledWith({ context: 'Ctx' }, 'отладка');
    expect(pino.trace).toHaveBeenCalledWith({ context: 'Ctx' }, 'подробно');
  });
});
