import { defineConfig } from 'drizzle-kit';

export default defineConfig({
  dialect: 'postgresql',
  schema: './src/schema/index.ts',
  out: './migrations',
  dbCredentials: { url: process.env.DATABASE_URL ?? 'postgresql://blokum:blokum@127.0.0.1:5432/blokum_dev' },
  strict: true,
  verbose: true,
});
