import { describe, expect, it } from 'vitest';
import type { SQL } from 'drizzle-orm';
import { PgDialect } from 'drizzle-orm/pg-core';
import type { Database } from '../database/database.types.js';
import { desabonnementToken } from '../database/schema.js';
import { loadConfig } from '../config.js';
import {
  RETENTION_DESABONNEMENT_TOKEN_JOURS,
  tachePurgeDesabonnementToken,
  tachesPurgeFoyer,
} from './taches-purge.js';

/**
 * Bornes temporelles de `svc-foyer`, testées **sans Postgres** : la base factice capture
 * le prédicat, rendu ensuite en SQL paramétré par le vrai dialecte drizzle. L'attendu est
 * donc **dérivé** du dialecte, pas recopié à la main.
 */

const dialect = new PgDialect();

function rendre(cond: SQL | undefined): {
  sql: string;
  params: readonly unknown[];
} {
  if (!cond) {
    throw new Error('condition WHERE absente');
  }
  return dialect.sqlToQuery(cond);
}

const BORNE = new Date('2023-08-12T10:00:00.000Z');

function fauxDb(lignes = 5): {
  db: Database;
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
  } as unknown as Database;
  return { db, conditions, tables };
}

describe('tachePurgeDesabonnementToken', () => {
  it('porte la durée du registre (T3bis : 3 ans)', () => {
    const tache = tachePurgeDesabonnementToken(fauxDb().db);
    expect(tache.nom).toBe('desabonnement_token');
    expect(tache.retentionJours).toBe(RETENTION_DESABONNEMENT_TOKEN_JOURS);
  });

  it('supprime sur la table des jetons et rend le nombre de lignes', async () => {
    const { db, tables } = fauxDb(11);
    expect(await tachePurgeDesabonnementToken(db).executer(BORNE)).toBe(11);
    expect(tables).toEqual([desabonnementToken]);
  });

  /**
   * **Sonde négative n°1** — le prédicat doit couvrir les jetons **jamais consommés**,
   * qui sont la quasi-totalité du volume (un jeton par destinataire et par récapitulatif
   * hebdomadaire). Ancré sur `utilise_le` seul, il serait nul pour eux : la borne
   * garderait tout le déchet et n'effacerait que les preuves — l'inverse de l'intention.
   */
  it('atteint les jetons jamais consommés, via leur date d’émission', async () => {
    const { db, conditions } = fauxDb();
    await tachePurgeDesabonnementToken(db).executer(BORNE);
    const { sql } = rendre(conditions[0]);
    expect(sql).toContain('"utilise_le" is null');
    expect(sql).toContain('"emis_le" < ');
  });

  /**
   * **Sonde négative n°2** — un jeton consommé se juge sur `utilise_le`, la trace
   * horodatée de l'exercice du droit d'opposition (ADR-0006), et non sur son émission.
   */
  it('juge un jeton consommé sur sa date d’usage', async () => {
    const { db, conditions } = fauxDb();
    await tachePurgeDesabonnementToken(db).executer(BORNE);
    const { sql, params } = rendre(conditions[0]);
    expect(sql).toContain('"utilise_le" is not null');
    expect(sql).toContain('"utilise_le" < ');
    // La borne reçue est liée aux deux branches, en chaîne ISO (mappeur `timestamp`).
    expect(params).toEqual([BORNE.toISOString(), BORNE.toISOString()]);
  });

  /**
   * **Garde dérivée, pas recopiée** : la borne doit rester très au-delà de la durée de
   * validité d'un jeton, sinon la purge se mettrait à manger des liens encore vivants et
   * un parent tomberait sur « lien invalide ou expiré ». Le TTL est **lu dans la
   * configuration**, de sorte que le jour où quelqu'un l'augmente, c'est ce test qui le
   * dit — pas la production.
   */
  it('reste très au-delà de la durée de validité d’un jeton', () => {
    const { ttlJours } = loadConfig().desabonnement;
    expect(ttlJours).toBeGreaterThan(0);
    expect(RETENTION_DESABONNEMENT_TOKEN_JOURS).toBeGreaterThan(ttlJours * 10);
  });
});

describe('tachesPurgeFoyer', () => {
  /**
   * `correction_journal` est délibérément absente : la durée que le registre lui assigne
   * part de la **date d'effet de la version**, colonne que la table ne porte pas. Écart
   * assumé, écrit en `docs/37-registre-des-traitements.md` §4 — ce test le rend visible.
   */
  it('ne borne que les jetons de désabonnement côté tables propres au service', () => {
    expect(tachesPurgeFoyer(fauxDb().db).map((t) => t.nom)).toEqual([
      'desabonnement_token',
    ]);
  });
});
