import { type ArgumentsHost, Catch, type ExceptionFilter, HttpException, HttpStatus, Inject } from '@nestjs/common';
import { type Response } from 'express';
import { type Alerts, type Logger, getRequestId } from '@blokum/observability';
import { ALERTS, LOGGER } from '../tokens.js';

const CODES: Record<number, [string, string]> = {
  400: ['BAD_REQUEST', 'Неверный запрос'],
  401: ['UNAUTHORIZED', 'Нужно войти'],
  403: ['FORBIDDEN', 'Нет доступа'],
  404: ['NOT_FOUND', 'Не найдено'],
  409: ['CONFLICT', 'Конфликт данных'],
  413: ['PAYLOAD_TOO_LARGE', 'Слишком большой запрос'],
  422: ['VALIDATION_FAILED', 'Данные не прошли проверку'],
  429: ['TOO_MANY_REQUESTS', 'Слишком много запросов, попробуйте позже'],
};

/** Alert rule for server errors (docs/02-ARCHITECTURE.md §9): 20 in a minute → one alert. */
export const HTTP_5XX_RULE = { threshold: 20, windowMs: 60_000 };

/**
 * Single error format `{ error: { code, message, details? } }` with Russian messages (docs/02-ARCHITECTURE.md §6).
 * Server errors are logged with the request id, counted for alerts and never leak internals to the client.
 */
@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  constructor(
    @Inject(LOGGER) private readonly logger: Logger,
    @Inject(ALERTS) private readonly alerts: Alerts,
  ) {}

  catch(exception: unknown, host: ArgumentsHost): void {
    const res = host.switchToHttp().getResponse<Response>();
    const requestId = getRequestId();
    const ownError = (e: HttpException) => {
      const body = e.getResponse();
      const err = typeof body === 'object' && body !== null ? (body as { error?: unknown }).error : undefined;
      return typeof err === 'object' && err !== null && 'code' in err && 'message' in err ? err : undefined;
    };
    // A deliberate «service unavailable» with our own code and Russian text (СМС budget, mail not connected) is an
    // expected answer, not a failure of the server: it goes to the client as is, without the 5xx alert.
    if (exception instanceof HttpException && exception.getStatus() === 503 && ownError(exception)) {
      this.logger.warn({ status: 503, code: (ownError(exception) as { code: unknown }).code }, 'сервис недоступен');
      res.status(503).json({ error: ownError(exception) });
      return;
    }
    if (exception instanceof HttpException && exception.getStatus() < 500) {
      const status = exception.getStatus();
      // Our own errors carry `{ error: { code, message } }`; NestJS built-ins carry English text — replaced.
      const custom = ownError(exception);
      const [code, message] = CODES[status] ?? ['ERROR', 'Ошибка запроса'];
      res.status(status).json({ error: custom ?? { code, message } });
      return;
    }
    const status = exception instanceof HttpException ? exception.getStatus() : HttpStatus.INTERNAL_SERVER_ERROR;
    this.logger.error({ err: exception, status }, 'необработанная ошибка');
    void this.alerts.hit('http_5xx', HTTP_5XX_RULE, 'Всплеск ошибок сервера (5xx) в API');
    res.status(status).json({
      error: { code: 'INTERNAL', message: `Внутренняя ошибка сервера. Код запроса: ${requestId ?? 'неизвестен'}` },
    });
  }
}
