import { pino, type DestinationStream, type Logger, type LoggerOptions } from 'pino';
import { maskString, maskValue } from './mask.js';
import { getRequestId } from './request-context.js';

export type { Logger } from 'pino';

export interface LoggerConfig {
  service: 'blokum-api' | 'blokum-web' | 'blokum-worker' | (string & {});
  level?: LoggerOptions['level'];
  version?: string;
}

/**
 * JSON logger (pino) for every process. Each record gets `service`, `version` and the current
 * `requestId`; every field and message is masked (phones, e-mails, cards, codes, tokens).
 */
export function createLogger(config: LoggerConfig, destination?: DestinationStream): Logger {
  const options: LoggerOptions = {
    level: config.level ?? (process.env.LOG_LEVEL || 'info'),
    base: { service: config.service, version: config.version ?? process.env.APP_VERSION ?? 'dev' },
    timestamp: pino.stdTimeFunctions.isoTime,
    messageKey: 'msg',
    mixin() {
      const requestId = getRequestId();
      return requestId ? { requestId } : {};
    },
    formatters: {
      level: (label) => ({ level: label }),
      log: (obj) => maskValue(obj) as Record<string, unknown>,
    },
    hooks: {
      logMethod(args, method) {
        const masked = args.map((a: unknown) => (typeof a === 'string' ? maskString(a) : a)) as Parameters<typeof method>;
        method.apply(this, masked);
      },
    },
  };
  return destination ? pino(options, destination) : pino(options);
}
