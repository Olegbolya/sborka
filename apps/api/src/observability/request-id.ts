import { type NextFunction, type Request, type Response } from 'express';
import { type Logger, REQUEST_ID_HEADER, newRequestId, normalizeRequestId, runWithRequestId } from '@blokum/observability';

/**
 * Express middleware: takes a safe `x-request-id` from the caller (web) or creates one, returns it
 * in the response, and makes it visible to every log line of the request. Writes one access-log line.
 */
export function requestContext(logger: Logger) {
  return (req: Request, res: Response, next: NextFunction): void => {
    const id = normalizeRequestId(req.headers[REQUEST_ID_HEADER]) ?? newRequestId();
    res.setHeader(REQUEST_ID_HEADER, id);
    const started = process.hrtime.bigint();
    runWithRequestId(id, () => {
      res.on('finish', () => {
        const ms = Number(process.hrtime.bigint() - started) / 1e6;
        const line = { method: req.method, path: req.originalUrl, status: res.statusCode, ms: Math.round(ms) };
        runWithRequestId(id, () => {
          if (res.statusCode >= 500) logger.error(line, 'запрос завершился ошибкой');
          else logger.info(line, 'запрос');
        });
      });
      next();
    });
  };
}
