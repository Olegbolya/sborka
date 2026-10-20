import { createId } from '@blokum/schema';
import { text, timestamp } from 'drizzle-orm/pg-core';

/** Text primary key generated with the safe alphabet of @blokum/schema (16 chars). */
export const id = () =>
  text('id')
    .primaryKey()
    .$defaultFn(() => createId());

export const createdAt = () => timestamp('created_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow();
export const updatedAt = () =>
  timestamp('updated_at', { withTimezone: true, mode: 'date' })
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date());
export const ts = (name: string) => timestamp(name, { withTimezone: true, mode: 'date' });
