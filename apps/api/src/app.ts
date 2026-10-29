import 'reflect-metadata';
import { type INestApplication } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { type NestExpressApplication } from '@nestjs/platform-express';
import { type AppDeps, AppModule } from './app.module.js';
import { type ApiConfig } from './config.js';
import { NestPinoLogger } from './observability/nest-logger.js';
import { requestContext } from './observability/request-id.js';

/** Global URL prefix of the API (docs/02-ARCHITECTURE.md §6). */
export const API_PREFIX = 'api/v1';

export async function createApp(config: ApiConfig, deps: AppDeps): Promise<INestApplication> {
  // A document may be up to 3 MB (DOCUMENT_LIMITS.bytes); the stock limit of the body parser is 100 kB.
  const app = await NestFactory.create<NestExpressApplication>(AppModule.register(config, deps), { logger: new NestPinoLogger(deps.logger), abortOnError: false, bodyParser: false });
  app.useBodyParser('json', { limit: '4mb' });
  app.useBodyParser('urlencoded', { extended: true, limit: '1mb' });
  app.use(requestContext(deps.logger));
  // ASVS V8.1.1, V8.3.2: answers of the API are not kept by browsers or proxies; the controllers of files set their own, longer, rule.
  // ASVS V14.4.2: an answer of the API is data, not a page: `attachment` keeps a browser from showing a JSON as a document; the file
  // controllers that want `inline` (images) or a named file (exports) say so themselves.
  app.getHttpAdapter().getInstance().disable('x-powered-by');
  app.use((_req: unknown, res: { setHeader(name: string, value: string): void; getHeader(name: string): unknown; json: (body: unknown) => unknown }, next: () => void) => {
    res.setHeader('Cache-Control', 'no-store');
    const json = res.json.bind(res);
    // Only a JSON answer gets it: the page of the development login emulator and the files must stay what they are.
    res.json = (body: unknown) => {
      if (res.getHeader('Content-Disposition') === undefined) res.setHeader('Content-Disposition', 'attachment; filename="api.json"');
      return json(body);
    };
    next();
  });
  app.setGlobalPrefix(API_PREFIX);
  app.enableShutdownHooks();
  return app;
}
