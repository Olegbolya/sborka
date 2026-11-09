import { type DynamicModule, Global, Module } from '@nestjs/common';
import { type Db } from '@blokum/db';
import { EntitlementsService } from './entitlements/entitlements.service.js';
import { DB } from './tokens.js';

/** Makes the Drizzle DB client and `EntitlementsService` (P7.1) available for injection across all modules. */
@Global()
@Module({})
export class DatabaseModule {
  static forRoot(db: Db): DynamicModule {
    return {
      module: DatabaseModule,
      providers: [{ provide: DB, useValue: db }, EntitlementsService],
      exports: [DB, EntitlementsService],
    };
  }
}
