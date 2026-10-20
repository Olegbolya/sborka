export interface ApiConfig {
  port: number;
  host: string;
  version: string;
}

/** Reads API settings from the environment; fails fast on invalid values. */
export function loadApiConfig(env: NodeJS.ProcessEnv = process.env): ApiConfig {
  const port = env.API_PORT ?? env.PORT ?? '3100';
  const parsed = Number(port);
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > 65535) {
    throw new Error(`Неверный порт API: «${port}»`);
  }
  return { port: parsed, host: env.API_HOST ?? '127.0.0.1', version: env.APP_VERSION ?? 'dev' };
}
