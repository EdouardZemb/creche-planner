import { describe, expect, it } from 'vitest';
import {
  Column,
  getTableColumns,
  getTableName,
  Param,
  type Table,
} from 'drizzle-orm';
import {
  CONTRAT_CREE_TYPE,
  CONTRAT_MODIFIE_TYPE,
  CONTRAT_SUPPRIME_TYPE,
  ETABLISSEMENT_CREE_TYPE,
  ETABLISSEMENT_MODIFIE_TYPE,
  ETABLISSEMENT_SUPPRIME_TYPE,
} from '@creche-planner/contracts-planification';
import {
  FOYER_SUPPRIME_TYPE,
  PARENT_AJOUTE_TYPE,
  PARENT_MODIFIE_TYPE,
  PARENT_RETIRE_TYPE,
  PREFERENCES_NOTIF_MODIFIEES_TYPE,
} from '@creche-planner/contracts-foyer';
import { ProjectionService } from './projection.service.js';
import type { Database } from '../database/database.types.js';
import {
  contrat,
  deadLetter,
  envoiEtablissement,
  envoiRecapHebdo,
  envoiRecapParent,
  etablissement,
  foyerParent,
  notification,
  notificationHebdo,
  preferenceNotification,
  processedEvent,
} from '../database/schema.js';

/**
 * Test d'**intégration** de la chaîne « événement → projection » du read model
 * Notifications : contrairement à `projection.service.spec.ts` (aiguillage, fakes
 * sans état), on vérifie ici le **contenu du read model `contrat`** après traitement,
 * l'**idempotence rejouée** (même enveloppe ré-livrée ⇒ no-op), la mise à jour par
 * `ContratModifie` et la suppression par `ContratSupprime` — sans Postgres.
 *
 * La base factice est **à état** : un magasin de lignes par table Drizzle, qui honore
 * le sous-ensemble utilisé par la projection — `select().from().where(eq)`,
 * `insert().values().onConflictDoNothing().returning()` (marqueur d'idempotence),
 * `insert().values().onConflictDoUpdate()` (upsert), `delete().where(eq)`. Les
 * conditions `eq(colonne, valeur)` sont évaluées en lisant les `queryChunks` drizzle
 * (colonne + paramètre lié) ; seul ce prédicat est supporté.
 */

type Ligne = Record<string, unknown>;

function fakeBaseEnMemoire(): {
  db: Database;
  lignesDe: (t: Table) => Ligne[];
} {
  const magasin = new Map<Table, Ligne[]>();
  const lignesDe = (table: Table): Ligne[] => {
    let lignes = magasin.get(table);
    if (!lignes) {
      lignes = [];
      magasin.set(table, lignes);
    }
    return lignes;
  };
  /** Nom de propriété TS d'une colonne dans sa table (ex. `contrat_id` → `contratId`). */
  const cleDe = (table: Table, colonne: Column): string => {
    const entree = Object.entries(getTableColumns(table)).find(
      ([, c]) => c === colonne,
    );
    if (!entree) {
      throw new Error(`colonne inconnue dans la table : ${colonne.name}`);
    }
    return entree[0];
  };
  /**
   * Évalue le prédicat d'un `where` : `eq(colonne, valeur)` (cas général) ou
   * `like(colonne, '%valeur%')` (purge de `dead_letter` à l'effacement d'un foyer).
   * Drizzle **ne lie pas** l'opérande d'un `like` dans un `Param` — il la pousse telle
   * quelle dans les `queryChunks` — d'où la distinction sur le type du chunk. Seuls
   * ces deux prédicats sont supportés.
   */
  const filtreEq = (table: Table, condition: unknown) => {
    const chunks = (condition as { queryChunks: unknown[] }).queryChunks;
    const colonne = chunks.find((c) => c instanceof Column) as Column;
    const cle = cleDe(table, colonne);
    const motif = chunks.find((c) => typeof c === 'string');
    if (typeof motif === 'string') {
      // Seule forme émise par la projection : `%<uuid>%` ⇒ sous-chaîne. La
      // colonne visée est textuelle (`dead_letter.payload`) : toute autre valeur
      // ne peut pas matcher, plutôt que d'être stringifiée en `[object Object]`.
      const aiguille = motif.replaceAll('%', '');
      return (ligne: Ligne) => {
        const valeur = ligne[cle];
        return typeof valeur === 'string' && valeur.includes(aiguille);
      };
    }
    const param = chunks.find((c) => c instanceof Param) as Param;
    return (ligne: Ligne) => ligne[cle] === param.value;
  };
  const clefConflit = (table: Table, cibles: Column[], ligne: Ligne): string =>
    cibles.map((c) => String(ligne[cleDe(table, c)])).join('|');
  /**
   * Évalue la garde de monotonie `setWhere`
   * (`<col> is null or <col> <= excluded.occurred_at`) : renvoie `true` si le `set`
   * doit s'appliquer, `false` si l'état stocké est plus récent (le `set` est ignoré).
   * Lit la colonne comparée dans les `queryChunks` du fragment `sql` ; seul ce
   * prédicat de monotonie est supporté.
   */
  const passeSetWhere = (
    table: Table,
    setWhere: unknown,
    existante: Ligne,
    valeurs: Ligne,
  ): boolean => {
    const chunks = (setWhere as { queryChunks: unknown[] }).queryChunks;
    const colonne = chunks.find((c) => c instanceof Column) as Column;
    const cle = cleDe(table, colonne);
    const stockee = existante[cle] as Date | null | undefined;
    if (stockee === null || stockee === undefined) {
      return true; // occurred_at NULL ⇒ auto-amorçage : on applique
    }
    return stockee.getTime() <= (valeurs[cle] as Date).getTime();
  };

  const operations = {
    select: () => ({
      from: (table: Table) => ({
        where: (condition: unknown) =>
          Promise.resolve(lignesDe(table).filter(filtreEq(table, condition))),
      }),
    }),
    insert: (table: Table) => ({
      values: (valeurs: Ligne) => ({
        // Marqueur d'idempotence : n'insère que si la clé est nouvelle.
        onConflictDoNothing: (opts: { target: Column }) => ({
          returning: () => {
            const clef = clefConflit(table, [opts.target], valeurs);
            const doublon = lignesDe(table).some(
              (l) => clefConflit(table, [opts.target], l) === clef,
            );
            if (doublon) {
              return Promise.resolve([]);
            }
            lignesDe(table).push({ ...valeurs });
            return Promise.resolve([{ id: valeurs['id'] }]);
          },
        }),
        // Upsert de projection : remplace sur conflit de clé (simple ou composite),
        // sous réserve de la garde de monotonie `setWhere` si elle est fournie.
        onConflictDoUpdate: (opts: {
          target: Column | Column[];
          set: Ligne;
          setWhere?: unknown;
        }) => {
          const cibles = Array.isArray(opts.target)
            ? opts.target
            : [opts.target];
          const clef = clefConflit(table, cibles, valeurs);
          const existante = lignesDe(table).find(
            (l) => clefConflit(table, cibles, l) === clef,
          );
          if (existante) {
            if (
              opts.setWhere === undefined ||
              passeSetWhere(table, opts.setWhere, existante, valeurs)
            ) {
              Object.assign(existante, opts.set);
            }
          } else {
            lignesDe(table).push({ ...valeurs });
          }
          return Promise.resolve();
        },
      }),
    }),
    update: (table: Table) => ({
      set: (valeurs: Ligne) => ({
        where: (condition: unknown) => {
          lignesDe(table)
            .filter(filtreEq(table, condition))
            .forEach((l) => Object.assign(l, valeurs));
          return Promise.resolve();
        },
      }),
    }),
    delete: (table: Table) => ({
      where: (condition: unknown) => {
        const lignes = lignesDe(table);
        const restantes = lignes.filter((l) => !filtreEq(table, condition)(l));
        lignes.splice(0, lignes.length, ...restantes);
        return Promise.resolve();
      },
    }),
  };

  const db = {
    ...operations,
    transaction: async (cb: (tx: unknown) => Promise<unknown>) =>
      cb(operations),
  } as unknown as Database;

  return { db, lignesDe };
}

const FOYER_ID = '22222222-2222-4222-8222-222222222222';
const CONTRAT_ID = '55555555-0000-4000-8000-000000000000';

function evenementContratCree(
  id: string,
  surcharge: Record<string, unknown> = {},
): unknown {
  return {
    id,
    type: CONTRAT_CREE_TYPE,
    source: 'svc-planification',
    version: 1,
    occurredAt: '2026-09-15T00:00:00.000Z',
    traceId: 'trace-1',
    payload: {
      contratId: CONTRAT_ID,
      foyerId: FOYER_ID,
      enfant: 'Mia',
      mode: 'CRECHE_PSU',
      valideDu: '2026-01-01',
      valideAu: null,
      ...surcharge,
    },
  };
}

function evenementContratModifie(id: string): unknown {
  return {
    id,
    type: CONTRAT_MODIFIE_TYPE,
    source: 'svc-planification',
    version: 1,
    occurredAt: '2026-10-01T00:00:00.000Z',
    traceId: 'trace-2',
    payload: {
      contratId: CONTRAT_ID,
      foyerId: FOYER_ID,
      enfant: 'Mia',
      mode: 'PERISCOLAIRE',
      valideDu: '2026-01-01',
      valideAu: '2026-12-31',
    },
  };
}

function evenementContratSupprime(id: string): unknown {
  return {
    id,
    type: CONTRAT_SUPPRIME_TYPE,
    source: 'svc-planification',
    version: 1,
    occurredAt: '2026-10-15T00:00:00.000Z',
    traceId: 'trace-3',
    payload: { contratId: CONTRAT_ID },
  };
}

describe('Projection ContratCree (contenu + idempotence rejouée)', () => {
  const ID_EVT = '11111111-1111-4111-8111-111111111111';

  it('projette l’identité et la période de validité dans le read model contrat', async () => {
    const { db, lignesDe } = fakeBaseEnMemoire();
    const projection = new ProjectionService(db);

    await expect(
      projection.traiter('PLANIFICATION', evenementContratCree(ID_EVT)),
    ).resolves.toBe('TRAITE');

    expect(lignesDe(contrat)).toHaveLength(1);
    expect(lignesDe(contrat)[0]).toMatchObject({
      id: CONTRAT_ID,
      foyerId: FOYER_ID,
      enfant: 'Mia',
      mode: 'CRECHE_PSU',
      valideDu: '2026-01-01',
      valideAu: null,
    });
    expect(lignesDe(processedEvent)).toHaveLength(1);
  });

  it('projette le lien établissement (etablissementId) porté par l’event (P3)', async () => {
    const { db, lignesDe } = fakeBaseEnMemoire();
    const projection = new ProjectionService(db);
    const ETAB = '99999999-9999-4999-8999-999999999999';

    await projection.traiter(
      'PLANIFICATION',
      evenementContratCree('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', {
        etablissementId: ETAB,
      }),
    );

    expect(lignesDe(contrat)[0]).toMatchObject({ etablissementId: ETAB });
  });

  it('projette etablissementId = null quand l’event ne le porte pas (rétro-compat)', async () => {
    const { db, lignesDe } = fakeBaseEnMemoire();
    const projection = new ProjectionService(db);

    await projection.traiter('PLANIFICATION', evenementContratCree(ID_EVT));

    expect(lignesDe(contrat)[0]).toMatchObject({ etablissementId: null });
  });

  it('idempotence REJOUÉE : la même enveloppe ré-livrée (at-least-once) est un no-op', async () => {
    const { db, lignesDe } = fakeBaseEnMemoire();
    const projection = new ProjectionService(db);
    await projection.traiter('PLANIFICATION', evenementContratCree(ID_EVT));

    // Rejeu de la MÊME enveloppe (même id) avec un payload altéré : si la
    // projection était ré-appliquée, l'enfant changerait.
    await expect(
      projection.traiter(
        'PLANIFICATION',
        evenementContratCree(ID_EVT, { enfant: 'Zoé' }),
      ),
    ).resolves.toBe('TRAITE');

    expect(lignesDe(contrat)).toHaveLength(1);
    expect(lignesDe(contrat)[0]).toMatchObject({ enfant: 'Mia' }); // 1ʳᵉ livraison conservée
    expect(lignesDe(processedEvent)).toHaveLength(1);
  });

  it('un ContratModifie (id différent) met à jour le contrat existant (upsert)', async () => {
    const { db, lignesDe } = fakeBaseEnMemoire();
    const projection = new ProjectionService(db);
    await projection.traiter('PLANIFICATION', evenementContratCree(ID_EVT));

    await projection.traiter(
      'PLANIFICATION',
      evenementContratModifie('22222222-2222-4222-8222-aaaaaaaaaaaa'),
    );

    expect(lignesDe(contrat)).toHaveLength(1); // toujours une seule ligne par contrat
    expect(lignesDe(contrat)[0]).toMatchObject({
      mode: 'PERISCOLAIRE',
      valideAu: '2026-12-31',
    });
    expect(lignesDe(processedEvent)).toHaveLength(2);
  });

  it('événement de type inconnu : acquitté sans RIEN projeter ni marquer', async () => {
    const { db, lignesDe } = fakeBaseEnMemoire();
    const projection = new ProjectionService(db);

    await expect(
      projection.traiter('PLANIFICATION', {
        id: ID_EVT,
        type: 'planification.PlanningModifie.v1',
        payload: {},
      }),
    ).resolves.toBe('IGNORE_TYPE_INCONNU');
    expect(lignesDe(contrat)).toHaveLength(0);
    expect(lignesDe(processedEvent)).toHaveLength(0);
  });
});

describe('Projection ContratSupprime', () => {
  const ID_EVT_CREE = '33333333-3333-4333-8333-333333333333';
  const ID_EVT_SUPPR = '44444444-4444-4444-8444-444444444444';

  it('supprime le contrat projeté ; le rejeu de la suppression est un no-op', async () => {
    const { db, lignesDe } = fakeBaseEnMemoire();
    const projection = new ProjectionService(db);
    await projection.traiter(
      'PLANIFICATION',
      evenementContratCree(ID_EVT_CREE),
    );
    expect(lignesDe(contrat)).toHaveLength(1);

    await expect(
      projection.traiter(
        'PLANIFICATION',
        evenementContratSupprime(ID_EVT_SUPPR),
      ),
    ).resolves.toBe('TRAITE');
    expect(lignesDe(contrat)).toHaveLength(0);

    // Rejeu de la MÊME suppression (même id) : marqueur déjà posé ⇒ no-op.
    await expect(
      projection.traiter(
        'PLANIFICATION',
        evenementContratSupprime(ID_EVT_SUPPR),
      ),
    ).resolves.toBe('TRAITE');
    expect(lignesDe(contrat)).toHaveLength(0);
    expect(
      lignesDe(processedEvent).filter((l) => l['id'] === ID_EVT_SUPPR),
    ).toHaveLength(1);
  });
});

const PARENT_ID = '88888888-8888-4888-8888-888888888888';

function evenementParent(
  type: string,
  id: string,
  surcharge: Record<string, unknown> = {},
): unknown {
  return {
    id,
    type,
    source: 'svc-foyer',
    version: 1,
    occurredAt: '2026-09-15T00:00:00.000Z',
    traceId: 'trace-p',
    payload: {
      foyerId: FOYER_ID,
      parentId: PARENT_ID,
      email: 'maman@test.fr',
      principal: true,
      actif: true,
      ...surcharge,
    },
  };
}

function evenementParentRetire(id: string): unknown {
  return {
    id,
    type: PARENT_RETIRE_TYPE,
    source: 'svc-foyer',
    version: 1,
    occurredAt: '2026-09-16T00:00:00.000Z',
    traceId: 'trace-pr',
    payload: { foyerId: FOYER_ID, parentId: PARENT_ID },
  };
}

describe('Projection foyer_parent (parents du foyer, stream FOYER)', () => {
  it('ParentAjoute projette l’état destinataire (email/principal/actif)', async () => {
    const { db, lignesDe } = fakeBaseEnMemoire();
    const projection = new ProjectionService(db);

    await expect(
      projection.traiter(
        'FOYER',
        evenementParent(
          PARENT_AJOUTE_TYPE,
          '11111111-1111-4111-8111-111111111111',
        ),
      ),
    ).resolves.toBe('TRAITE');

    expect(lignesDe(foyerParent)).toHaveLength(1);
    expect(lignesDe(foyerParent)[0]).toMatchObject({
      parentId: PARENT_ID,
      foyerId: FOYER_ID,
      email: 'maman@test.fr',
      principal: true,
      actif: true,
    });
    expect(lignesDe(processedEvent)).toHaveLength(1);
  });

  it('idempotence REJOUÉE : la même enveloppe ParentAjoute ré-livrée est un no-op', async () => {
    const { db, lignesDe } = fakeBaseEnMemoire();
    const projection = new ProjectionService(db);
    const ID = '11111111-1111-4111-8111-111111111111';
    await projection.traiter('FOYER', evenementParent(PARENT_AJOUTE_TYPE, ID));

    await projection.traiter(
      'FOYER',
      evenementParent(PARENT_AJOUTE_TYPE, ID, { email: 'autre@test.fr' }),
    );

    expect(lignesDe(foyerParent)).toHaveLength(1);
    expect(lignesDe(foyerParent)[0]).toMatchObject({ email: 'maman@test.fr' });
    expect(lignesDe(processedEvent)).toHaveLength(1);
  });

  it('ParentModifie (id différent) met à jour la ligne du parent (upsert)', async () => {
    const { db, lignesDe } = fakeBaseEnMemoire();
    const projection = new ProjectionService(db);
    await projection.traiter(
      'FOYER',
      evenementParent(
        PARENT_AJOUTE_TYPE,
        '11111111-1111-4111-8111-111111111111',
      ),
    );

    await projection.traiter(
      'FOYER',
      evenementParent(
        PARENT_MODIFIE_TYPE,
        '22222222-2222-4222-8222-bbbbbbbbbbbb',
        { email: 'maman.nouvelle@test.fr', principal: false },
      ),
    );

    expect(lignesDe(foyerParent)).toHaveLength(1);
    expect(lignesDe(foyerParent)[0]).toMatchObject({
      email: 'maman.nouvelle@test.fr',
      principal: false,
    });
    expect(lignesDe(processedEvent)).toHaveLength(2);
  });

  it('ParentRetire bascule actif=false (soft-delete) ; le rejeu est un no-op', async () => {
    const { db, lignesDe } = fakeBaseEnMemoire();
    const projection = new ProjectionService(db);
    await projection.traiter(
      'FOYER',
      evenementParent(
        PARENT_AJOUTE_TYPE,
        '11111111-1111-4111-8111-111111111111',
      ),
    );
    const ID_RETIRE = '33333333-3333-4333-8333-333333333333';

    await expect(
      projection.traiter('FOYER', evenementParentRetire(ID_RETIRE)),
    ).resolves.toBe('TRAITE');
    expect(lignesDe(foyerParent)).toHaveLength(1);
    expect(lignesDe(foyerParent)[0]).toMatchObject({ actif: false });

    // Rejeu de la MÊME enveloppe : marqueur déjà posé ⇒ aucune nouvelle écriture.
    await expect(
      projection.traiter('FOYER', evenementParentRetire(ID_RETIRE)),
    ).resolves.toBe('TRAITE');
    expect(
      lignesDe(processedEvent).filter((l) => l['id'] === ID_RETIRE),
    ).toHaveLength(1);
  });
});

const ETAB_ID = '99999999-9999-4999-8999-999999999999';

function evenementEtablissement(
  type: string,
  id: string,
  surcharge: Record<string, unknown> = {},
): unknown {
  return {
    id,
    type,
    source: 'svc-planification',
    version: 1,
    occurredAt: '2026-09-15T00:00:00.000Z',
    traceId: 'trace-e',
    payload: {
      etablissementId: ETAB_ID,
      foyerId: FOYER_ID,
      nom: 'Crèche du centre',
      emailService: 'creche@test.fr',
      preavisRegle: { type: 'JOURS_OUVRES', valeur: 2 },
      types: ['CRECHE_PSU'],
      actif: true,
      ...surcharge,
    },
  };
}

function evenementEtablissementSupprime(id: string): unknown {
  return {
    id,
    type: ETABLISSEMENT_SUPPRIME_TYPE,
    source: 'svc-planification',
    version: 1,
    occurredAt: '2026-10-15T00:00:00.000Z',
    traceId: 'trace-es',
    payload: { etablissementId: ETAB_ID },
  };
}

interface PrefEntree {
  typeNotification: string;
  canal: string;
  actif: boolean;
}

function evenementPreferences(id: string, preferences: PrefEntree[]): unknown {
  return {
    id,
    type: PREFERENCES_NOTIF_MODIFIEES_TYPE,
    source: 'svc-foyer',
    version: 1,
    occurredAt: '2026-09-15T00:00:00.000Z',
    traceId: 'trace-pref',
    payload: { foyerId: FOYER_ID, parentId: PARENT_ID, preferences },
  };
}

describe('Projection preference_notification (préférences, stream FOYER)', () => {
  it('projette l’état complet des préférences du parent (une ligne par triplet)', async () => {
    const { db, lignesDe } = fakeBaseEnMemoire();
    const projection = new ProjectionService(db);

    await expect(
      projection.traiter(
        'FOYER',
        evenementPreferences('11111111-1111-4111-8111-ffffffffffff', [
          {
            typeNotification: 'VALIDATION_HEBDO',
            canal: 'EMAIL',
            actif: false,
          },
          {
            typeNotification: 'VALIDATION_HEBDO',
            canal: 'IN_APP',
            actif: true,
          },
        ]),
      ),
    ).resolves.toBe('TRAITE');

    expect(lignesDe(preferenceNotification)).toHaveLength(2);
    expect(lignesDe(preferenceNotification)).toContainEqual(
      expect.objectContaining({
        parentId: PARENT_ID,
        typeNotification: 'VALIDATION_HEBDO',
        canal: 'EMAIL',
        actif: false,
      }),
    );
    expect(lignesDe(processedEvent)).toHaveLength(1);
  });

  it('idempotence REJOUÉE : la même enveloppe ré-livrée (at-least-once) est un no-op', async () => {
    const { db, lignesDe } = fakeBaseEnMemoire();
    const projection = new ProjectionService(db);
    const ID = '11111111-1111-4111-8111-ffffffffffff';
    await projection.traiter(
      'FOYER',
      evenementPreferences(ID, [
        { typeNotification: 'VALIDATION_HEBDO', canal: 'EMAIL', actif: false },
      ]),
    );

    // Rejeu de la MÊME enveloppe (même id) avec un état altéré : si la projection
    // était ré-appliquée, `actif` passerait à true.
    await projection.traiter(
      'FOYER',
      evenementPreferences(ID, [
        { typeNotification: 'VALIDATION_HEBDO', canal: 'EMAIL', actif: true },
      ]),
    );

    expect(lignesDe(preferenceNotification)).toHaveLength(1);
    expect(lignesDe(preferenceNotification)[0]).toMatchObject({ actif: false });
    expect(lignesDe(processedEvent)).toHaveLength(1);
  });

  it('remplace l’état complet : une préférence remise au défaut (retirée de l’event) disparaît', async () => {
    const { db, lignesDe } = fakeBaseEnMemoire();
    const projection = new ProjectionService(db);
    await projection.traiter(
      'FOYER',
      evenementPreferences('11111111-1111-4111-8111-ffffffffffff', [
        { typeNotification: 'VALIDATION_HEBDO', canal: 'EMAIL', actif: false },
        { typeNotification: 'VALIDATION_HEBDO', canal: 'IN_APP', actif: false },
      ]),
    );
    expect(lignesDe(preferenceNotification)).toHaveLength(2);

    // Nouvel event (id différent) portant un état RÉDUIT : la ligne IN_APP a été
    // remise au défaut côté svc-foyer et n'est plus transportée → elle doit disparaître.
    await projection.traiter(
      'FOYER',
      evenementPreferences('22222222-2222-4222-8222-ffffffffffff', [
        { typeNotification: 'VALIDATION_HEBDO', canal: 'EMAIL', actif: true },
      ]),
    );

    expect(lignesDe(preferenceNotification)).toHaveLength(1);
    expect(lignesDe(preferenceNotification)[0]).toMatchObject({
      canal: 'EMAIL',
      actif: true,
    });
    expect(lignesDe(processedEvent)).toHaveLength(2);
  });

  it('NAK (re-livraison) si le payload est invalide', async () => {
    const { db, lignesDe } = fakeBaseEnMemoire();
    const projection = new ProjectionService(db);

    await expect(
      projection.traiter('FOYER', {
        ...(evenementPreferences('33333333-3333-4333-8333-ffffffffffff', [
          { typeNotification: 'VALIDATION_HEBDO', canal: 'EMAIL', actif: true },
        ]) as Record<string, unknown>),
        payload: { parentId: 'pas-un-uuid' },
      }),
    ).resolves.toBe('ECHEC_TRANSITOIRE');
    expect(lignesDe(preferenceNotification)).toHaveLength(0);
    expect(lignesDe(processedEvent)).toHaveLength(0);
  });
});

describe('Projection établissement (fiche projetée, stream PLANIFICATION)', () => {
  it('EtablissementCree projette la fiche (nom/email/préavis/types/actif)', async () => {
    const { db, lignesDe } = fakeBaseEnMemoire();
    const projection = new ProjectionService(db);

    await expect(
      projection.traiter(
        'PLANIFICATION',
        evenementEtablissement(
          ETABLISSEMENT_CREE_TYPE,
          '11111111-1111-4111-8111-eeeeeeeeeeee',
        ),
      ),
    ).resolves.toBe('TRAITE');

    expect(lignesDe(etablissement)).toHaveLength(1);
    expect(lignesDe(etablissement)[0]).toMatchObject({
      id: ETAB_ID,
      foyerId: FOYER_ID,
      nom: 'Crèche du centre',
      emailService: 'creche@test.fr',
      preavisRegle: { type: 'JOURS_OUVRES', valeur: 2 },
      types: ['CRECHE_PSU'],
      actif: true,
    });
    expect(lignesDe(processedEvent)).toHaveLength(1);
  });

  it('idempotence REJOUÉE : la même enveloppe EtablissementCree est un no-op', async () => {
    const { db, lignesDe } = fakeBaseEnMemoire();
    const projection = new ProjectionService(db);
    const ID = '11111111-1111-4111-8111-eeeeeeeeeeee';
    await projection.traiter(
      'PLANIFICATION',
      evenementEtablissement(ETABLISSEMENT_CREE_TYPE, ID),
    );

    await projection.traiter(
      'PLANIFICATION',
      evenementEtablissement(ETABLISSEMENT_CREE_TYPE, ID, { nom: 'Autre' }),
    );

    expect(lignesDe(etablissement)).toHaveLength(1);
    expect(lignesDe(etablissement)[0]).toMatchObject({
      nom: 'Crèche du centre',
    });
    expect(lignesDe(processedEvent)).toHaveLength(1);
  });

  it('EtablissementModifie (id différent) met à jour la fiche (upsert)', async () => {
    const { db, lignesDe } = fakeBaseEnMemoire();
    const projection = new ProjectionService(db);
    await projection.traiter(
      'PLANIFICATION',
      evenementEtablissement(
        ETABLISSEMENT_CREE_TYPE,
        '11111111-1111-4111-8111-eeeeeeeeeeee',
      ),
    );

    await projection.traiter(
      'PLANIFICATION',
      evenementEtablissement(
        ETABLISSEMENT_MODIFIE_TYPE,
        '22222222-2222-4222-8222-eeeeeeeeeeee',
        { emailService: 'nouveau@test.fr', actif: false },
      ),
    );

    expect(lignesDe(etablissement)).toHaveLength(1);
    expect(lignesDe(etablissement)[0]).toMatchObject({
      emailService: 'nouveau@test.fr',
      actif: false,
    });
    expect(lignesDe(processedEvent)).toHaveLength(2);
  });

  it('EtablissementSupprime retire la fiche ; le rejeu est un no-op', async () => {
    const { db, lignesDe } = fakeBaseEnMemoire();
    const projection = new ProjectionService(db);
    await projection.traiter(
      'PLANIFICATION',
      evenementEtablissement(
        ETABLISSEMENT_CREE_TYPE,
        '11111111-1111-4111-8111-eeeeeeeeeeee',
      ),
    );
    expect(lignesDe(etablissement)).toHaveLength(1);
    const ID_SUPPR = '33333333-3333-4333-8333-eeeeeeeeeeee';

    await expect(
      projection.traiter(
        'PLANIFICATION',
        evenementEtablissementSupprime(ID_SUPPR),
      ),
    ).resolves.toBe('TRAITE');
    expect(lignesDe(etablissement)).toHaveLength(0);

    // Rejeu de la MÊME suppression : marqueur déjà posé ⇒ no-op.
    await expect(
      projection.traiter(
        'PLANIFICATION',
        evenementEtablissementSupprime(ID_SUPPR),
      ),
    ).resolves.toBe('TRAITE');
    expect(lignesDe(etablissement)).toHaveLength(0);
    expect(
      lignesDe(processedEvent).filter((l) => l['id'] === ID_SUPPR),
    ).toHaveLength(1);
  });
});

/**
 * Garde de **monotonie** `occurred_at` (lot 4 « Confiance & quotidien ») : un
 * événement plus ANCIEN re-livré (NAK/backoff JetStream) ne doit plus écraser un
 * état plus récent. Deux angles par handler : « désordre » (le récent T2 puis
 * l'ancien T1 ⇒ l'état reste T2) et « rattrapage » (l'ancien puis le récent ⇒
 * convergence vers T2). Ids d'enveloppe différents (sinon `processed_event`
 * masquerait la garde). `appliquerPreferencesNotif` (delete+insert) est protégé
 * par un pré-check `max(occurred_at)`, pas par un `setWhere`.
 */
describe('Garde de monotonie occurred_at (désordre / rattrapage)', () => {
  const T1 = '2026-09-01T00:00:00.000Z';
  const T2 = '2026-09-02T00:00:00.000Z';
  const ID_X = 'aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa'; // événement récent (T2)
  const ID_Y = 'bbbbbbbb-2222-4222-8222-bbbbbbbbbbbb'; // événement ancien (T1)

  const avecInstant = (evt: unknown, occurredAt: string): unknown => ({
    ...(evt as Record<string, unknown>),
    occurredAt,
  });

  const evtContrat = (
    type: string,
    id: string,
    occurredAt: string,
    enfant: string,
  ): unknown => ({
    id,
    type,
    source: 'svc-planification',
    version: 1,
    occurredAt,
    traceId: 'trace-mono',
    payload: {
      contratId: CONTRAT_ID,
      foyerId: FOYER_ID,
      enfant,
      mode: 'CRECHE_PSU',
      valideDu: '2026-01-01',
      valideAu: null,
    },
  });

  it('ContratCree — désordre : l’ancien re-livré n’écrase pas l’état récent', async () => {
    const { db, lignesDe } = fakeBaseEnMemoire();
    const projection = new ProjectionService(db);

    await projection.traiter(
      'PLANIFICATION',
      evtContrat(CONTRAT_CREE_TYPE, ID_X, T2, 'Zoé'),
    );
    await projection.traiter(
      'PLANIFICATION',
      evtContrat(CONTRAT_CREE_TYPE, ID_Y, T1, 'Mia'),
    );

    expect(lignesDe(contrat)).toHaveLength(1);
    expect(lignesDe(contrat)[0]).toMatchObject({
      enfant: 'Zoé',
      eventId: ID_X,
    });
    expect(lignesDe(processedEvent)).toHaveLength(2);
  });

  it('ContratCree — rattrapage : l’ancien puis le récent convergent vers T2', async () => {
    const { db, lignesDe } = fakeBaseEnMemoire();
    const projection = new ProjectionService(db);

    await projection.traiter(
      'PLANIFICATION',
      evtContrat(CONTRAT_CREE_TYPE, ID_Y, T1, 'Mia'),
    );
    await projection.traiter(
      'PLANIFICATION',
      evtContrat(CONTRAT_CREE_TYPE, ID_X, T2, 'Zoé'),
    );

    expect(lignesDe(contrat)[0]).toMatchObject({
      enfant: 'Zoé',
      eventId: ID_X,
    });
  });

  it('ContratModifie — désordre : l’ancien re-livré n’écrase pas l’état récent', async () => {
    const { db, lignesDe } = fakeBaseEnMemoire();
    const projection = new ProjectionService(db);

    await projection.traiter(
      'PLANIFICATION',
      evtContrat(CONTRAT_MODIFIE_TYPE, ID_X, T2, 'Zoé'),
    );
    await projection.traiter(
      'PLANIFICATION',
      evtContrat(CONTRAT_MODIFIE_TYPE, ID_Y, T1, 'Mia'),
    );

    expect(lignesDe(contrat)).toHaveLength(1);
    expect(lignesDe(contrat)[0]).toMatchObject({
      enfant: 'Zoé',
      eventId: ID_X,
    });
  });

  it('ContratModifie — rattrapage : l’ancien puis le récent convergent vers T2', async () => {
    const { db, lignesDe } = fakeBaseEnMemoire();
    const projection = new ProjectionService(db);

    await projection.traiter(
      'PLANIFICATION',
      evtContrat(CONTRAT_MODIFIE_TYPE, ID_Y, T1, 'Mia'),
    );
    await projection.traiter(
      'PLANIFICATION',
      evtContrat(CONTRAT_MODIFIE_TYPE, ID_X, T2, 'Zoé'),
    );

    expect(lignesDe(contrat)[0]).toMatchObject({
      enfant: 'Zoé',
      eventId: ID_X,
    });
  });

  it('ParentEtat — désordre : l’ancien re-livré n’écrase pas l’état récent', async () => {
    const { db, lignesDe } = fakeBaseEnMemoire();
    const projection = new ProjectionService(db);

    await projection.traiter(
      'FOYER',
      avecInstant(
        evenementParent(PARENT_MODIFIE_TYPE, ID_X, { email: 'recent@test.fr' }),
        T2,
      ),
    );
    await projection.traiter(
      'FOYER',
      avecInstant(
        evenementParent(PARENT_MODIFIE_TYPE, ID_Y, { email: 'ancien@test.fr' }),
        T1,
      ),
    );

    expect(lignesDe(foyerParent)).toHaveLength(1);
    expect(lignesDe(foyerParent)[0]).toMatchObject({
      email: 'recent@test.fr',
      eventId: ID_X,
    });
  });

  it('ParentEtat — rattrapage : l’ancien puis le récent convergent vers T2', async () => {
    const { db, lignesDe } = fakeBaseEnMemoire();
    const projection = new ProjectionService(db);

    await projection.traiter(
      'FOYER',
      avecInstant(
        evenementParent(PARENT_MODIFIE_TYPE, ID_Y, { email: 'ancien@test.fr' }),
        T1,
      ),
    );
    await projection.traiter(
      'FOYER',
      avecInstant(
        evenementParent(PARENT_MODIFIE_TYPE, ID_X, { email: 'recent@test.fr' }),
        T2,
      ),
    );

    expect(lignesDe(foyerParent)[0]).toMatchObject({
      email: 'recent@test.fr',
      eventId: ID_X,
    });
  });

  it('EtablissementEtat — désordre : l’ancien re-livré n’écrase pas l’état récent', async () => {
    const { db, lignesDe } = fakeBaseEnMemoire();
    const projection = new ProjectionService(db);

    await projection.traiter(
      'PLANIFICATION',
      avecInstant(
        evenementEtablissement(ETABLISSEMENT_MODIFIE_TYPE, ID_X, {
          emailService: 'recent@test.fr',
        }),
        T2,
      ),
    );
    await projection.traiter(
      'PLANIFICATION',
      avecInstant(
        evenementEtablissement(ETABLISSEMENT_MODIFIE_TYPE, ID_Y, {
          emailService: 'ancien@test.fr',
        }),
        T1,
      ),
    );

    expect(lignesDe(etablissement)).toHaveLength(1);
    expect(lignesDe(etablissement)[0]).toMatchObject({
      emailService: 'recent@test.fr',
      eventId: ID_X,
    });
  });

  it('EtablissementEtat — rattrapage : l’ancien puis le récent convergent vers T2', async () => {
    const { db, lignesDe } = fakeBaseEnMemoire();
    const projection = new ProjectionService(db);

    await projection.traiter(
      'PLANIFICATION',
      avecInstant(
        evenementEtablissement(ETABLISSEMENT_MODIFIE_TYPE, ID_Y, {
          emailService: 'ancien@test.fr',
        }),
        T1,
      ),
    );
    await projection.traiter(
      'PLANIFICATION',
      avecInstant(
        evenementEtablissement(ETABLISSEMENT_MODIFIE_TYPE, ID_X, {
          emailService: 'recent@test.fr',
        }),
        T2,
      ),
    );

    expect(lignesDe(etablissement)[0]).toMatchObject({
      emailService: 'recent@test.fr',
      eventId: ID_X,
    });
  });

  it('PreferencesNotif — désordre : le pré-check ignore un event plus ancien (consommé, non appliqué)', async () => {
    const { db, lignesDe } = fakeBaseEnMemoire();
    const projection = new ProjectionService(db);

    await projection.traiter(
      'FOYER',
      avecInstant(
        evenementPreferences(ID_X, [
          {
            typeNotification: 'VALIDATION_HEBDO',
            canal: 'EMAIL',
            actif: false,
          },
        ]),
        T2,
      ),
    );
    await projection.traiter(
      'FOYER',
      avecInstant(
        evenementPreferences(ID_Y, [
          { typeNotification: 'VALIDATION_HEBDO', canal: 'EMAIL', actif: true },
        ]),
        T1,
      ),
    );

    expect(lignesDe(preferenceNotification)).toHaveLength(1);
    expect(lignesDe(preferenceNotification)[0]).toMatchObject({ actif: false });
    // Les deux enveloppes sont consommées (marqueur posé), l'ancienne non appliquée.
    expect(lignesDe(processedEvent)).toHaveLength(2);
  });

  it('PreferencesNotif — rattrapage : l’ancien puis le récent convergent vers T2', async () => {
    const { db, lignesDe } = fakeBaseEnMemoire();
    const projection = new ProjectionService(db);

    await projection.traiter(
      'FOYER',
      avecInstant(
        evenementPreferences(ID_Y, [
          { typeNotification: 'VALIDATION_HEBDO', canal: 'EMAIL', actif: true },
        ]),
        T1,
      ),
    );
    await projection.traiter(
      'FOYER',
      avecInstant(
        evenementPreferences(ID_X, [
          {
            typeNotification: 'VALIDATION_HEBDO',
            canal: 'EMAIL',
            actif: false,
          },
        ]),
        T2,
      ),
    );

    expect(lignesDe(preferenceNotification)).toHaveLength(1);
    expect(lignesDe(preferenceNotification)[0]).toMatchObject({ actif: false });
  });
});

/**
 * Effacement d'un foyer (`foyer.FoyerSupprime.v1`, RGPD doc 37 §3) — **oracle de
 * résidu** du lot : on peuple chaque table que le service alimente, on livre
 * l'enveloppe, et on exige **zéro ligne** dans chacune. La sonde négative est aussi
 * importante que l'assertion principale : une purge trop gourmande (un `foyer_id`
 * oublié dans un `where`, un `like` trop large) viderait aussi le foyer voisin et
 * passerait pour un succès sans elle.
 */

const AUTRE_FOYER_ID = '77777777-7777-4777-8777-777777777777';
const AUTRE_PARENT_ID = '66666666-6666-4666-8666-666666666666';

/** Tables que l'effacement doit vider (ordre du handler). */
const TABLES_EFFACEES: readonly Table[] = [
  notification,
  preferenceNotification,
  envoiRecapParent,
  envoiRecapHebdo,
  envoiEtablissement,
  notificationHebdo,
  contrat,
  etablissement,
  foyerParent,
  deadLetter,
];

/**
 * Pose **une** ligne par table effaçable pour un couple (foyer, parent). `marque`
 * distingue les jeux (`cible` vs `autre`) dans les clés techniques et les PII.
 */
function peupler(
  lignesDe: (t: Table) => Ligne[],
  foyerId: string,
  parentId: string,
  marque: string,
): void {
  lignesDe(notification).push({
    id: `n-${marque}`,
    parentId,
    type: 'VALIDATION_HEBDO',
    sujet: 'Votre semaine est à valider',
    corps: `Le planning de Mia (${marque})`,
    lien: null,
    cleIdempotence: `VALIDATION_HEBDO:2026-W27`,
    luLe: null,
  });
  lignesDe(preferenceNotification).push({
    parentId,
    typeNotification: 'VALIDATION_HEBDO',
    canal: 'EMAIL',
    actif: false,
  });
  lignesDe(envoiRecapParent).push({
    foyerId,
    semaineIso: '2026-W27',
    parentId,
    statut: 'ENVOYE',
    email: `${marque}@test.fr`,
    essais: 0,
  });
  lignesDe(envoiRecapHebdo).push({
    foyerId,
    semaineIso: '2026-W27',
    statut: 'ENVOYE',
    destinataires: [`${marque}@test.fr`],
  });
  lignesDe(envoiEtablissement).push({
    id: `e-${marque}`,
    foyerId,
    semaineIso: '2026-W27',
    etablissementId: ETAB_ID,
    destinataire: 'creche@test.fr',
    sujet: 'Récapitulatif de la semaine',
    corps: `Mia absente jeudi (${marque})`,
    statut: 'ENVOYE',
  });
  lignesDe(notificationHebdo).push({
    id: `h-${marque}`,
    contratId: CONTRAT_ID,
    foyerId,
    semaineIso: '2026-W27',
    type: 'VALIDATION_HEBDO',
    statut: 'A_VALIDER',
    snapshot: {},
  });
  lignesDe(contrat).push({
    id: `c-${marque}`,
    foyerId,
    enfant: 'Mia',
    mode: 'CRECHE_PSU',
    valideDu: '2026-01-01',
    valideAu: null,
  });
  lignesDe(etablissement).push({
    id: `t-${marque}`,
    foyerId,
    nom: 'Crèche du centre',
    emailService: 'creche@test.fr',
    actif: true,
  });
  lignesDe(foyerParent).push({
    parentId,
    foyerId,
    email: `${marque}@test.fr`,
    principal: true,
    actif: true,
  });
  // Payload **en clair** d'un event du stream FOYER non géré ici : c'est la raison
  // pour laquelle `dead_letter` entre dans le périmètre d'effacement.
  lignesDe(deadLetter).push({
    id: `d-${marque}`,
    envelopeId: null,
    stream: 'FOYER',
    sujet: 'foyer.EnfantAjoute.v1',
    raison: 'IGNORE_TYPE_INCONNU',
    payload: `{"payload":{"foyerId":"${foyerId}","prenom":"Mia"}}`,
    erreur: null,
    livraisons: 1,
  });
}

function evenementFoyerSupprime(
  id: string,
  parentIds: readonly string[],
): unknown {
  return {
    id,
    type: FOYER_SUPPRIME_TYPE,
    source: 'svc-foyer',
    version: 1,
    occurredAt: '2026-10-20T00:00:00.000Z',
    traceId: 'trace-fs',
    payload: { foyerId: FOYER_ID, parentIds },
  };
}

describe('Effacement FoyerSupprime (résidu zéro + sonde négative)', () => {
  const ID_EVT = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';

  it('ne laisse AUCUNE ligne du foyer dans les tables du service', async () => {
    const { db, lignesDe } = fakeBaseEnMemoire();
    const projection = new ProjectionService(db);
    peupler(lignesDe, FOYER_ID, PARENT_ID, 'cible');
    for (const table of TABLES_EFFACEES) {
      expect(lignesDe(table)).toHaveLength(1); // le jeu est bien en place
    }

    await expect(
      projection.traiter('FOYER', evenementFoyerSupprime(ID_EVT, [PARENT_ID])),
    ).resolves.toBe('TRAITE');

    for (const table of TABLES_EFFACEES) {
      expect(
        lignesDe(table),
        `résidu dans ${getTableName(table)}`,
      ).toHaveLength(0);
    }
  });

  it('sonde négative : les lignes d’un AUTRE foyer survivent intactes', async () => {
    const { db, lignesDe } = fakeBaseEnMemoire();
    const projection = new ProjectionService(db);
    peupler(lignesDe, FOYER_ID, PARENT_ID, 'cible');
    peupler(lignesDe, AUTRE_FOYER_ID, AUTRE_PARENT_ID, 'autre');

    await projection.traiter(
      'FOYER',
      evenementFoyerSupprime(ID_EVT, [PARENT_ID]),
    );

    for (const table of TABLES_EFFACEES) {
      expect(
        lignesDe(table),
        `purge trop gourmande sur ${getTableName(table)}`,
      ).toHaveLength(1);
    }
    expect(lignesDe(notification)[0]).toMatchObject({
      parentId: AUTRE_PARENT_ID,
    });
    expect(lignesDe(deadLetter)[0]).toMatchObject({ id: 'd-autre' });
  });

  it('union payload ∪ foyer_parent : un parent projeté hors payload est effacé', async () => {
    const { db, lignesDe } = fakeBaseEnMemoire();
    const projection = new ProjectionService(db);
    peupler(lignesDe, FOYER_ID, PARENT_ID, 'cible');
    // Co-parent connu du read model local mais **absent** du payload (écart normal
    // entre deux read models distribués) : sans l'union, sa boîte resterait orpheline.
    lignesDe(foyerParent).push({
      parentId: AUTRE_PARENT_ID,
      foyerId: FOYER_ID,
      email: 'coparent@test.fr',
      principal: false,
      actif: false, // parent RETIRÉ : c'est le cas que le payload seul rate
    });
    lignesDe(notification).push({
      id: 'n-coparent',
      parentId: AUTRE_PARENT_ID,
      type: 'VALIDATION_HEBDO',
      sujet: 'Votre semaine est à valider',
      corps: 'Le planning de Mia',
      luLe: null,
    });

    await projection.traiter(
      'FOYER',
      evenementFoyerSupprime(ID_EVT, [PARENT_ID]),
    );

    expect(lignesDe(notification)).toHaveLength(0);
    expect(lignesDe(foyerParent)).toHaveLength(0);
  });

  it('rejeu de la MÊME enveloppe : no-op (aucune nouvelle suppression)', async () => {
    const { db, lignesDe } = fakeBaseEnMemoire();
    const projection = new ProjectionService(db);
    peupler(lignesDe, FOYER_ID, PARENT_ID, 'cible');
    await projection.traiter(
      'FOYER',
      evenementFoyerSupprime(ID_EVT, [PARENT_ID]),
    );
    expect(lignesDe(notification)).toHaveLength(0);

    // Ligne écrite APRÈS l'effacement : un rejeu de la même enveloppe (marqueur déjà
    // posé) ne doit rien re-supprimer — c'est la preuve que le handler est un no-op.
    lignesDe(notification).push({
      id: 'n-apres',
      parentId: PARENT_ID,
      type: 'VALIDATION_HEBDO',
      sujet: 'Écrite après l’effacement',
      corps: '…',
      luLe: null,
    });

    await expect(
      projection.traiter('FOYER', evenementFoyerSupprime(ID_EVT, [PARENT_ID])),
    ).resolves.toBe('TRAITE');

    expect(lignesDe(notification)).toHaveLength(1);
    expect(
      lignesDe(processedEvent).filter((l) => l['id'] === ID_EVT),
    ).toHaveLength(1);
  });
});
