import { describe, expect, it } from 'vitest';
import type { SQL } from 'drizzle-orm';
import { PgDialect } from 'drizzle-orm/pg-core';
import type { Database } from '../database/database.types.js';
import {
  envoiEtablissement,
  envoiRecapHebdo,
  envoiRecapParent,
  notification,
} from '../database/schema.js';
import {
  RETENTION_NOTIFICATION_JOURS,
  RETENTION_PREUVE_ENVOI_JOURS,
  tacheAnonymisationEnvoiEtablissement,
  tachePurgeEnvoiRecapHebdo,
  tachePurgeEnvoiRecapParent,
  tachePurgeNotification,
  tachesPurgeNotifications,
} from './taches-purge.js';

/**
 * Bornes temporelles de `svc-notifications`, testées **sans Postgres** : la base factice
 * capture table, `set` et prédicat ; le prédicat est rendu en SQL paramétré par le vrai
 * dialecte drizzle, donc l'attendu est **dérivé** plutôt que recopié.
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

const BORNE = new Date('2025-07-12T10:00:00.000Z');
const BORNE_LIEE = BORNE.toISOString();

interface Captures {
  readonly tablesSupprimees: unknown[];
  readonly tablesModifiees: unknown[];
  readonly sets: Record<string, unknown>[];
  readonly conditions: (SQL | undefined)[];
}

function fauxDb(lignes = 6): { db: Database; captures: Captures } {
  const captures: Captures = {
    tablesSupprimees: [],
    tablesModifiees: [],
    sets: [],
    conditions: [],
  };
  const resoudre = (cond: SQL | undefined): Promise<{ count: number }> => {
    captures.conditions.push(cond);
    return Promise.resolve({ count: lignes });
  };
  const db = {
    delete: (table: unknown) => {
      captures.tablesSupprimees.push(table);
      return { where: resoudre };
    },
    update: (table: unknown) => {
      captures.tablesModifiees.push(table);
      return {
        set: (valeurs: Record<string, unknown>) => {
          captures.sets.push(valeurs);
          return { where: resoudre };
        },
      };
    },
  } as unknown as Database;
  return { db, captures };
}

describe('tachePurgeNotification', () => {
  it('supprime la boîte de réception au-delà de 12 mois, sur cree_le', async () => {
    const { db, captures } = fauxDb(9);
    const tache = tachePurgeNotification(db);
    expect(tache.retentionJours).toBe(RETENTION_NOTIFICATION_JOURS);
    expect(await tache.executer(BORNE)).toBe(9);
    expect(captures.tablesSupprimees).toEqual([notification]);
    const { sql, params } = rendre(captures.conditions[0]);
    expect(sql).toBe('"notification"."cree_le" < $1');
    expect(params).toEqual([BORNE_LIEE]);
  });
});

describe.each([
  {
    nom: 'envoi_recap_hebdo',
    tache: tachePurgeEnvoiRecapHebdo,
    table: envoiRecapHebdo,
  },
  {
    nom: 'envoi_recap_parent',
    tache: tachePurgeEnvoiRecapParent,
    table: envoiRecapParent,
  },
])('$nom', ({ nom, tache, table }) => {
  it('porte la durée des preuves d’envoi (T3 : 13 mois)', () => {
    const construite = tache(fauxDb().db);
    expect(construite.nom).toBe(nom);
    expect(construite.retentionJours).toBe(RETENTION_PREUVE_ENVOI_JOURS);
  });

  /**
   * **Sonde négative** — `envoye_le` reste nul pour tout ce qui n'a pas abouti (créneau
   * réservé jamais traité, envoi interrompu, créneau abandonné). Un prédicat sur cette
   * seule colonne laisserait ces lignes en base pour toujours, et ce sont justement
   * celles qui portent le plus d'adresses figées : la purge paraîtrait réussie en
   * n'ayant rien fait là où il fallait agir.
   */
  it('atteint aussi les lignes jamais abouties, via leur date de création', async () => {
    const { db, captures } = fauxDb();
    await tache(db).executer(BORNE);
    expect(captures.tablesSupprimees).toEqual([table]);
    const { sql, params } = rendre(captures.conditions[0]);
    expect(sql).toContain('"envoye_le" is null');
    expect(sql).toContain('"cree_le" < ');
    expect(params).toEqual([BORNE_LIEE, BORNE_LIEE]);
  });

  /** `maj_le` est réécrit à chaque transition : ce n'est pas une ancre d'âge. */
  it('n’ancre jamais la borne sur maj_le', async () => {
    const { db, captures } = fauxDb();
    await tache(db).executer(BORNE);
    expect(rendre(captures.conditions[0]).sql).not.toContain('maj_le');
  });
});

describe('tacheAnonymisationEnvoiEtablissement', () => {
  /**
   * **La garde du lot.** Cette ligne est le seul verrou anti-double-envoi vers l'adresse
   * d'une vraie crèche, et l'endpoint d'envoi n'est borné par aucune date. La supprimer
   * rouvrirait un second courriel réel — même famille de piège que purger
   * `processed_event`, mais côté sortant. On anonymise donc **en place**.
   */
  it('modifie la ligne au lieu de la supprimer', async () => {
    const { db, captures } = fauxDb(4);
    expect(await tacheAnonymisationEnvoiEtablissement(db).executer(BORNE)).toBe(
      4,
    );
    expect(captures.tablesSupprimees).toEqual([]);
    expect(captures.tablesModifiees).toEqual([envoiEtablissement]);
  });

  it('efface le contenu personnel et laisse la ligne-témoin', async () => {
    const { db, captures } = fauxDb();
    await tacheAnonymisationEnvoiEtablissement(db).executer(BORNE);
    expect(captures.sets[0]).toEqual({
      destinataire: '',
      sujet: '',
      corps: '',
      messageId: null,
      erreur: null,
    });
    // Ce qui prouve l'envoi — et arme le verrou — n'est pas touché.
    expect(Object.keys(captures.sets[0] ?? {})).not.toContain('statut');
    expect(Object.keys(captures.sets[0] ?? {})).not.toContain('envoyeLe');
    expect(Object.keys(captures.sets[0] ?? {})).not.toContain('semaineIso');
  });

  /**
   * **Sonde négative** — sans la garde `corps <> ''`, chaque passage recompterait les
   * mêmes lignes déjà anonymisées : la métrique gonflerait indéfiniment et une purge
   * inerte passerait pour une purge active.
   */
  it('ne repasse pas sur une ligne déjà anonymisée', async () => {
    const { db, captures } = fauxDb();
    await tacheAnonymisationEnvoiEtablissement(db).executer(BORNE);
    const { sql, params } = rendre(captures.conditions[0]);
    expect(sql).toContain('"corps" <> ');
    expect(params).toContain('');
  });

  it('porte la même durée que les autres preuves d’envoi', () => {
    const tache = tacheAnonymisationEnvoiEtablissement(fauxDb().db);
    expect(tache.nom).toBe('envoi_etablissement_anonymisation');
    expect(tache.retentionJours).toBe(RETENTION_PREUVE_ENVOI_JOURS);
  });
});

describe('tachesPurgeNotifications', () => {
  /**
   * `notification_hebdo` est délibérément absente : c'est la **machine à états** de la
   * validation hebdomadaire, pas un journal — l'absence d'une ligne y vaut « semaine
   * jamais notifiée », et la purger ferait disparaître une action en attente sans laisser
   * de trace. Écart assumé, écrit en `docs/37-registre-des-traitements.md` §4.
   */
  it('borne les quatre tables prévues, et pas notification_hebdo', () => {
    expect(tachesPurgeNotifications(fauxDb().db).map((t) => t.nom)).toEqual([
      'notification',
      'envoi_recap_hebdo',
      'envoi_recap_parent',
      'envoi_etablissement_anonymisation',
    ]);
  });
});
