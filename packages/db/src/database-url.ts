export interface DatabaseTarget {
  host: string;
  port: number;
  database: string;
  user: string;
}

/**
 * Validates DATABASE_URL. On the home server PostgreSQL listens on IPv4 only, so `localhost`
 * (which may resolve to ::1) is rejected in favour of 127.0.0.1 — a lesson from BST.
 */
export function parseDatabaseUrl(raw: string | undefined): DatabaseTarget {
  if (!raw) throw new Error('Не задана переменная DATABASE_URL');
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new Error('DATABASE_URL не является корректным адресом');
  }
  if (url.protocol !== 'postgresql:' && url.protocol !== 'postgres:') {
    throw new Error('DATABASE_URL должен начинаться с postgresql://');
  }
  if (url.hostname === 'localhost') {
    throw new Error('Используйте 127.0.0.1 вместо localhost: PostgreSQL на сервере слушает только IPv4');
  }
  const database = decodeURIComponent(url.pathname.replace(/^\//, ''));
  if (!database) throw new Error('В DATABASE_URL не указано имя базы');
  if (!url.username) throw new Error('В DATABASE_URL не указан пользователь');
  return { host: url.hostname, port: url.port ? Number(url.port) : 5432, database, user: decodeURIComponent(url.username) };
}
