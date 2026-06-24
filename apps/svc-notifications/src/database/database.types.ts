import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import type * as schema from './schema.js';

/** Client Drizzle typé par le schéma du service (injecté via le jeton `DRIZZLE`). */
export type Database = PostgresJsDatabase<typeof schema>;
