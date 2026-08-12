import { describe, expect, it } from 'vitest';
import type { SQL } from 'drizzle-orm';
import {
  PgDialect,
  pgTable,
  timestamp,
  uuid,
  varchar,
} from 'drizzle-orm/pg-core';
import { jsonb, text, integer } from 'drizzle-orm/pg-core';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import type { TableDeadLetter } from '../messaging/dead-letter.options.js';
import type { TableOutbox } from '../outbox/outbox.options.js';
import {
  RETENTION_DEAD_LETTER_JOURS,
  RETENTION_OUTBOX_JOURS,
} from './purge.options.js';
import { tachePurgeDeadLetter, tachePurgeOutbox } from './purge.taches.js';

/**
 * Tests des bornes mutualisées **sans Postgres** : une base factice capture le prédicat
 * du `where`, qui est ensuite **rendu en SQL paramétré** par le vrai dialecte drizzle.
 *
 * C'est délibérément le SQL qui est asserté, pas un tableau de lignes filtrées par un
 * faux moteur : l'attendu est ainsi **dérivé** du dialecte réel plutôt que recopié à la
 * main, et une fausse base qui évaluerait elle-même les prédicats divergerait du pilote
 * sur des détails d'implémentation (`LE-32`).
 */

const dialect = new PgDialect();

/** Rend une condition drizzle en SQL paramétré. */
function rendre(cond: SQL | undefined): {
  sql: string;
  params: readonly unknown[];
} {
  if (!cond) {
    throw new Error('condition WHERE absente');
  }
  const { sql, params } = dialect.sqlToQuery(cond);
  return { sql, params };
}

/** Répliques locales des deux modèles partagés (le modèle de la lib n'est pas exporté). */
const outbox = pgTable('outbox', {
  id: uuid('id').primaryKey(),
  type: varchar('type', { length: 200 }).notNull(),
  payload: jsonb('payload').notNull(),
  occurredAt: timestamp('occurred_at', { withTimezone: true })
    .notNull()
    .defaultNow(),
  traceId: varchar('trace_id', { length: 64 }).notNull(),
  publishedAt: timestamp('published_at', { withTimezone: true }),
}) as unknown as TableOutbox;

const deadLetter = pgTable('dead_letter', {
  id: uuid('id').primaryKey().defaultRandom(),
  envelopeId: uuid('envelope_id'),
  stream: varchar('stream', { length: 32 }).notNull(),
  sujet: varchar('sujet', { length: 200 }).notNull(),
  raison: varchar('raison', { length: 32 }).notNull(),
  payload: text('payload').notNull(),
  erreur: text('erreur'),
  livraisons: integer('livraisons').notNull().default(1),
  createdAt: timestamp('created_at', { withTimezone: true })
    .notNull()
    .defaultNow(),
}) as unknown as TableDeadLetter;

const BORNE = new Date('2026-05-13T00:00:00.000Z');

/**
 * La borne est liée en **chaîne ISO**, pas en `Date` : c'est le mappeur de colonne
 * `timestamp` de drizzle qui sérialise, et Postgres qui reparse. Constaté en faisant
 * rougir l'assertion, pas supposé (`LE-32`).
 */
const BORNE_LIEE = BORNE.toISOString();

function fauxDb(lignes = 7): {
  db: PostgresJsDatabase;
  conditions: (SQL | undefined)[];
  tables: unknown[];
} {
  const conditions: (SQL | undefined)[] = [];
  const tables: unknown[] = [];
  const db = {
    delete: (table: unknown) => {
      tables.push(table);
      return {
        where: (cond: SQL | undefined) => {
          conditions.push(cond);
          return Promise.resolve({ count: lignes });
        },
      };
    },
  } as unknown as PostgresJsDatabase;
  return { db, conditions, tables };
}

describe('tachePurgeOutbox', () => {
  it('porte la durée du registre et le nom attendu', () => {
    const tache = tachePurgeOutbox(fauxDb().db, outbox);
    expect(tache.nom).toBe('outbox');
    expect(tache.retentionJours).toBe(RETENTION_OUTBOX_JOURS);
  });

  it('supprime sur la table outbox et rend le nombre de lignes supprimées', async () => {
    const { db, tables } = fauxDb(42);
    expect(await tachePurgeOutbox(db, outbox).executer(BORNE)).toBe(42);
    expect(tables).toEqual([outbox]);
  });

  /**
   * **Sonde négative n°1 — la seule qui compte vraiment.** Un événement jamais publié
   * doit survivre quel que soit son âge : c'est un message **en vol**, que le relais
   * republiera. Le cas le plus coûteux est `foyer.FoyerSupprime.v1`, seul porteur
   * survivant d'un effacement de foyer une fois la transaction source commitée.
   *
   * Le test rougit si quelqu'un retire `published_at IS NOT NULL` du prédicat.
   */
  it('ne peut pas emporter un événement non publié : le prédicat exige published_at non nul', async () => {
    const { db, conditions } = fauxDb();
    await tachePurgeOutbox(db, outbox).executer(BORNE);
    const { sql } = rendre(conditions[0]);
    expect(sql).toContain('"published_at" is not null');
  });

  /**
   * **Sonde négative n°2** — la borne est ancrée sur `published_at`, jamais sur
   * `occurred_at` : ancrer sur la date d'occurrence reviendrait à juger un événement sur
   * son âge plutôt que sur son sort, donc à emporter la file vivante.
   */
  it("n'ancre pas la borne sur occurred_at", async () => {
    const { db, conditions } = fauxDb();
    await tachePurgeOutbox(db, outbox).executer(BORNE);
    expect(rendre(conditions[0]).sql).not.toContain('occurred_at');
  });

  /**
   * **Sonde négative n°3** — la comparaison est **stricte** et liée à la borne reçue :
   * une ligne publiée exactement à la borne, donc juste sous elle, survit.
   */
  it('compare strictement à la borne reçue, qui est liée en paramètre', async () => {
    const { db, conditions } = fauxDb();
    await tachePurgeOutbox(db, outbox).executer(BORNE);
    const { sql, params } = rendre(conditions[0]);
    expect(sql).toBe(
      '("outbox"."published_at" is not null and "outbox"."published_at" < $1)',
    );
    expect(params).toEqual([BORNE_LIEE]);
  });
});

describe('tachePurgeDeadLetter', () => {
  it('porte la durée du registre et le nom attendu', () => {
    const tache = tachePurgeDeadLetter(fauxDb().db, deadLetter);
    expect(tache.nom).toBe('dead_letter');
    expect(tache.retentionJours).toBe(RETENTION_DEAD_LETTER_JOURS);
  });

  it('supprime sur created_at, en comparaison stricte à la borne reçue', async () => {
    const { db, conditions, tables } = fauxDb(3);
    expect(await tachePurgeDeadLetter(db, deadLetter).executer(BORNE)).toBe(3);
    expect(tables).toEqual([deadLetter]);
    const { sql, params } = rendre(conditions[0]);
    expect(sql).toContain('"created_at" < $1');
    expect(params).toEqual([BORNE_LIEE]);
  });

  it('accepte une durée explicite quand un service veut diverger', () => {
    expect(
      tachePurgeDeadLetter(fauxDb().db, deadLetter, 180).retentionJours,
    ).toBe(180);
  });
});
