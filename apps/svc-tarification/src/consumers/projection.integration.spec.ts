import { describe, expect, it, vi } from 'vitest';
import { Column, getTableColumns, Param, type Table } from 'drizzle-orm';
import {
  FOYER_MIS_A_JOUR_TYPE,
  FOYER_MIS_A_JOUR_V2_TYPE,
} from '@creche-planner/contracts-foyer';
import { GRILLE_PUBLIEE_TYPE } from '@creche-planner/contracts-referentiel';
import {
  CONTRAT_CREE_TYPE,
  CONTRAT_MODIFIE_TYPE,
  PLANNING_MODIFIE_TYPE,
} from '@creche-planner/contracts-planification';
import { ProjectionService } from './projection.service.js';
import type { Database } from '../database/database.types.js';
import type { PlanificationClient } from '../fallback/planification.client.js';
import {
  contrat,
  foyer,
  grilleTarifaire,
  prestationMois,
  processedEvent,
} from '../database/schema.js';

/**
 * Test d'**intégration** de la chaîne « événement → projection » (AQ-09, doc 27) :
 * contrairement à `projection.service.spec.ts` (aiguillage, fakes sans état), on
 * vérifie ici le **contenu du read model** après traitement, l'**idempotence
 * rejouée** (même enveloppe ré-livrée ⇒ no-op), la rétro-compat v2 et l'ordre des
 * événements planification (PlanningModifie avant ContratCree ⇒ NAK puis
 * convergence à la re-livraison) — sans Postgres ni stack E2E.
 *
 * La base factice est **à état** : un magasin de lignes par table Drizzle, qui
 * honore le sous-ensemble utilisé par la projection — `select().from().where(eq)`,
 * `insert().values().onConflictDoNothing().returning()` (marqueur d'idempotence),
 * `insert().values().onConflictDoUpdate()` (upserts), `update`/`delete`. Les
 * conditions `eq(colonne, valeur)` sont évaluées en lisant les `queryChunks`
 * drizzle (colonne + paramètre lié) ; seul ce prédicat est supporté.
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
  /** Évalue un `eq(colonne, valeur)` (seul prédicat utilisé par la projection). */
  const filtreEq = (table: Table, condition: unknown) => {
    const chunks = (condition as { queryChunks: unknown[] }).queryChunks;
    const colonne = chunks.find((c) => c instanceof Column) as Column;
    const param = chunks.find((c) => c instanceof Param) as Param;
    const cle = cleDe(table, colonne);
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
const MOIS = '2026-10';

const clientMuet = { prestations: vi.fn() } as unknown as PlanificationClient;

function evenementFoyer(
  id: string,
  surcharge: Record<string, unknown> = {},
): unknown {
  return {
    id,
    type: FOYER_MIS_A_JOUR_TYPE,
    source: 'svc-foyer',
    version: 1,
    occurredAt: '2026-09-01T00:00:00.000Z',
    traceId: 'trace-1',
    payload: {
      foyerId: FOYER_ID,
      ressourcesMensuellesCentimes: 671692,
      rfrCentimes: 7270500,
      nbEnfantsACharge: 2,
      nbParts: 3,
      tranche: 3,
      ...surcharge,
    },
  };
}

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
    traceId: 'trace-2',
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

function evenementContratModifie(
  id: string,
  surcharge: Record<string, unknown> = {},
): unknown {
  return {
    ...(evenementContratCree(id, surcharge) as Record<string, unknown>),
    type: CONTRAT_MODIFIE_TYPE,
    occurredAt: '2026-10-01T00:00:00.000Z',
    traceId: 'trace-5',
  };
}

function evenementPlanning(id: string): unknown {
  return {
    id,
    type: PLANNING_MODIFIE_TYPE,
    source: 'svc-planification',
    version: 1,
    occurredAt: '2026-10-01T00:00:00.000Z',
    traceId: 'trace-3',
    payload: { contratId: CONTRAT_ID, mois: MOIS, simule: false },
  };
}

describe('Projection FoyerMisAJour (contenu + idempotence rejouée)', () => {
  const ID_EVT = '11111111-1111-4111-8111-111111111111';

  it('projette le payload v1 dans le read model foyer (contenu exact)', async () => {
    const { db, lignesDe } = fakeBaseEnMemoire();
    const projection = new ProjectionService(db, clientMuet);

    await expect(
      projection.traiter('FOYER', evenementFoyer(ID_EVT)),
    ).resolves.toBe('TRAITE');

    expect(lignesDe(foyer)).toHaveLength(1);
    expect(lignesDe(foyer)[0]).toMatchObject({
      id: FOYER_ID,
      ressourcesMensuellesCentimes: 671692,
      rfrCentimes: 7270500,
      tranche: 3,
      nbParts: '3', // numeric Drizzle : projeté en chaîne
      nbEnfantsACharge: 2,
      eventId: ID_EVT,
    });
    expect(lignesDe(processedEvent)).toHaveLength(1);
  });

  it('idempotence REJOUÉE : la même enveloppe ré-livrée (at-least-once) est un no-op', async () => {
    const { db, lignesDe } = fakeBaseEnMemoire();
    const projection = new ProjectionService(db, clientMuet);
    await projection.traiter('FOYER', evenementFoyer(ID_EVT));

    // Rejeu de la MÊME enveloppe (même id) avec un payload altéré : si la
    // projection était ré-appliquée, les ressources changeraient.
    await expect(
      projection.traiter(
        'FOYER',
        evenementFoyer(ID_EVT, { ressourcesMensuellesCentimes: 999999 }),
      ),
    ).resolves.toBe('TRAITE');

    expect(lignesDe(foyer)).toHaveLength(1);
    expect(lignesDe(foyer)[0]).toMatchObject({
      ressourcesMensuellesCentimes: 671692, // valeur de la 1ʳᵉ livraison conservée
    });
    expect(lignesDe(processedEvent)).toHaveLength(1);
  });

  it('un NOUVEL événement (id différent) met à jour la projection existante (upsert)', async () => {
    const { db, lignesDe } = fakeBaseEnMemoire();
    const projection = new ProjectionService(db, clientMuet);
    await projection.traiter('FOYER', evenementFoyer(ID_EVT));

    await projection.traiter(
      'FOYER',
      evenementFoyer('11111111-1111-4111-8111-222222222222', {
        ressourcesMensuellesCentimes: 720000,
        tranche: 2,
      }),
    );

    expect(lignesDe(foyer)).toHaveLength(1); // toujours une seule ligne par foyer
    expect(lignesDe(foyer)[0]).toMatchObject({
      ressourcesMensuellesCentimes: 720000,
      tranche: 2,
      eventId: '11111111-1111-4111-8111-222222222222',
    });
    expect(lignesDe(processedEvent)).toHaveLength(2);
  });

  it('rétro-compat : un FoyerMisAJour.v2 (anneeRevenus) projette le même read model que v1', async () => {
    const { db, lignesDe } = fakeBaseEnMemoire();
    const projection = new ProjectionService(db, clientMuet);

    const evtV2: Record<string, unknown> = {
      ...(evenementFoyer('77777777-7777-4777-8777-777777777777') as Record<
        string,
        unknown
      >),
      type: FOYER_MIS_A_JOUR_V2_TYPE,
      version: 2,
    };
    (evtV2['payload'] as Record<string, unknown>)['anneeRevenus'] = 2024;

    await expect(projection.traiter('FOYER', evtV2)).resolves.toBe('TRAITE');
    // Même projection que v1 : le champ optionnel v2 n'altère pas le read model.
    expect(lignesDe(foyer)[0]).toMatchObject({
      id: FOYER_ID,
      ressourcesMensuellesCentimes: 671692,
      tranche: 3,
    });
  });

  it('événement de type inconnu : acquitté sans RIEN projeter ni marquer', async () => {
    const { db, lignesDe } = fakeBaseEnMemoire();
    const projection = new ProjectionService(db, clientMuet);

    await expect(
      projection.traiter('FOYER', {
        id: ID_EVT,
        type: 'autre.Chose.v1',
        payload: {},
      }),
    ).resolves.toBe('IGNORE_TYPE_INCONNU');
    expect(lignesDe(foyer)).toHaveLength(0);
    expect(lignesDe(processedEvent)).toHaveLength(0);
  });
});

describe('Projection GrillePubliee (référentiel)', () => {
  it('projette la grille puis rejoue en no-op (idempotence)', async () => {
    const { db, lignesDe } = fakeBaseEnMemoire();
    const projection = new ProjectionService(db, clientMuet);
    const evt = {
      id: '33333333-3333-4333-8333-333333333333',
      type: GRILLE_PUBLIEE_TYPE,
      source: 'svc-referentiel',
      version: 1,
      occurredAt: '2026-01-01T00:00:00.000Z',
      traceId: 'trace-4',
      payload: {
        grilleId: '44444444-0000-4000-8000-000000000000',
        mode: 'CANTINE',
        tranche: 3,
        valideDu: '2026-01-01',
        valideAu: null,
      },
    };

    await expect(projection.traiter('REFERENTIEL', evt)).resolves.toBe(
      'TRAITE',
    );
    await expect(projection.traiter('REFERENTIEL', evt)).resolves.toBe(
      'TRAITE',
    );

    expect(lignesDe(grilleTarifaire)).toHaveLength(1);
    expect(lignesDe(grilleTarifaire)[0]).toMatchObject({
      id: '44444444-0000-4000-8000-000000000000',
      mode: 'CANTINE',
      tranche: 3,
      valideDu: '2026-01-01',
    });
    expect(lignesDe(processedEvent)).toHaveLength(1);
  });
});

describe('Chaîne planification : ContratCree → PlanningModifie → prestation projetée', () => {
  const ID_EVT_CONTRAT = '44444444-4444-4444-8444-444444444444';
  const ID_EVT_PLANNING = '66666666-6666-4666-8666-666666666666';

  /** Prestations renvoyées par le client de repli (quantités sans montant). */
  const reponsePrestations = {
    contratId: CONTRAT_ID,
    mois: MOIS,
    simule: false,
    prestations: [{ mode: 'CRECHE_PSU' as const, heuresFacturees: 9000 }],
  };

  it('projette l’identité du contrat puis les prestations du mois ; le rejeu est un no-op SANS appel réseau', async () => {
    const { db, lignesDe } = fakeBaseEnMemoire();
    const client = {
      prestations: vi.fn(async () => reponsePrestations),
    } as unknown as PlanificationClient;
    const projection = new ProjectionService(db, client);

    await expect(
      projection.traiter('PLANIFICATION', evenementContratCree(ID_EVT_CONTRAT)),
    ).resolves.toBe('TRAITE');
    expect(lignesDe(contrat)[0]).toMatchObject({
      id: CONTRAT_ID,
      foyerId: FOYER_ID,
      enfant: 'Mia',
      mode: 'CRECHE_PSU',
    });

    await expect(
      projection.traiter('PLANIFICATION', evenementPlanning(ID_EVT_PLANNING)),
    ).resolves.toBe('TRAITE');
    // La prestation projetée est rattachée à l'identité du contrat (foyer/enfant/mode).
    expect(lignesDe(prestationMois)).toHaveLength(1);
    expect(lignesDe(prestationMois)[0]).toMatchObject({
      contratId: CONTRAT_ID,
      foyerId: FOYER_ID,
      enfant: 'Mia',
      mode: 'CRECHE_PSU',
      mois: MOIS,
      simule: false,
      prestations: { mode: 'CRECHE_PSU', heuresFacturees: 9000 },
      eventId: ID_EVT_PLANNING,
    });

    // Idempotence rejouée : même enveloppe ré-livrée ⇒ ACK direct, pas de 2ᵉ
    // appel au repli planification, read model inchangé.
    await expect(
      projection.traiter('PLANIFICATION', evenementPlanning(ID_EVT_PLANNING)),
    ).resolves.toBe('TRAITE');
    expect(client.prestations).toHaveBeenCalledTimes(1);
    expect(lignesDe(prestationMois)).toHaveLength(1);
    expect(lignesDe(processedEvent)).toHaveLength(2); // contrat + planning
  });

  it('PlanningModifie reçu AVANT ContratCree : NAK (rien projeté, rien marqué), puis convergence à la re-livraison', async () => {
    const { db, lignesDe } = fakeBaseEnMemoire();
    const client = {
      prestations: vi.fn(async () => reponsePrestations),
    } as unknown as PlanificationClient;
    const projection = new ProjectionService(db, client);

    // Ordre inversé (livraison inter-streams non ordonnée) : contrat inconnu ⇒ NAK.
    await expect(
      projection.traiter('PLANIFICATION', evenementPlanning(ID_EVT_PLANNING)),
    ).resolves.toBe('ECHEC_TRANSITOIRE');
    expect(lignesDe(prestationMois)).toHaveLength(0);
    // L'événement n'est PAS marqué traité : la re-livraison reste possible.
    expect(lignesDe(processedEvent)).toHaveLength(0);

    // Le ContratCree arrive, puis JetStream re-livre le PlanningModifie : convergence.
    await projection.traiter(
      'PLANIFICATION',
      evenementContratCree(ID_EVT_CONTRAT),
    );
    await expect(
      projection.traiter('PLANIFICATION', evenementPlanning(ID_EVT_PLANNING)),
    ).resolves.toBe('TRAITE');
    expect(lignesDe(prestationMois)).toHaveLength(1);
  });

  it('repli planification indisponible : NAK, l’événement reste re-livrable', async () => {
    const { db, lignesDe } = fakeBaseEnMemoire();
    const client = {
      prestations: vi.fn(async () => undefined), // dégradation propre du client
    } as unknown as PlanificationClient;
    const projection = new ProjectionService(db, client);
    await projection.traiter(
      'PLANIFICATION',
      evenementContratCree(ID_EVT_CONTRAT),
    );

    await expect(
      projection.traiter('PLANIFICATION', evenementPlanning(ID_EVT_PLANNING)),
    ).resolves.toBe('ECHEC_TRANSITOIRE');
    expect(lignesDe(prestationMois)).toHaveLength(0);
    expect(
      lignesDe(processedEvent).filter((l) => l['id'] === ID_EVT_PLANNING),
    ).toHaveLength(0);
  });
});

describe('Projection « première inscription » (Coûts lot 4b)', () => {
  const ID_EVT_CONTRAT = '44444444-4444-4444-8444-444444444444';
  const ID_EVT_MODIF = '88888888-8888-4888-8888-888888888888';

  it('ContratCree avec premiereInscription: true + valideDu alimente les colonnes', async () => {
    const { db, lignesDe } = fakeBaseEnMemoire();
    const projection = new ProjectionService(db, clientMuet);

    await expect(
      projection.traiter(
        'PLANIFICATION',
        evenementContratCree(ID_EVT_CONTRAT, {
          mode: 'CANTINE',
          valideDu: '2026-09-01',
          premiereInscription: true,
        }),
      ),
    ).resolves.toBe('TRAITE');

    expect(lignesDe(contrat)[0]).toMatchObject({
      id: CONTRAT_ID,
      mode: 'CANTINE',
      premiereInscription: true,
      valideDu: '2026-09-01',
    });
  });

  it('événement SANS le champ (antérieur au lot 4a) : projette false, valideDu conservé', async () => {
    const { db, lignesDe } = fakeBaseEnMemoire();
    const projection = new ProjectionService(db, clientMuet);

    await projection.traiter(
      'PLANIFICATION',
      evenementContratCree(ID_EVT_CONTRAT), // pas de premiereInscription
    );

    expect(lignesDe(contrat)[0]).toMatchObject({
      id: CONTRAT_ID,
      premiereInscription: false,
      valideDu: '2026-01-01', // toujours présent dans le payload v1
    });
  });

  it('ContratModifie met à jour premiereInscription/valideDu (upsert `set`)', async () => {
    const { db, lignesDe } = fakeBaseEnMemoire();
    const projection = new ProjectionService(db, clientMuet);

    await projection.traiter(
      'PLANIFICATION',
      evenementContratCree(ID_EVT_CONTRAT),
    );
    await expect(
      projection.traiter(
        'PLANIFICATION',
        evenementContratModifie(ID_EVT_MODIF, {
          mode: 'CANTINE',
          valideDu: '2026-09-01',
          premiereInscription: true,
        }),
      ),
    ).resolves.toBe('TRAITE');

    expect(lignesDe(contrat)).toHaveLength(1);
    expect(lignesDe(contrat)[0]).toMatchObject({
      id: CONTRAT_ID,
      premiereInscription: true,
      valideDu: '2026-09-01',
    });
  });

  it('rejeu idempotent : la même enveloppe ré-livrée ne rebascule pas le champ', async () => {
    const { db, lignesDe } = fakeBaseEnMemoire();
    const projection = new ProjectionService(db, clientMuet);

    await projection.traiter(
      'PLANIFICATION',
      evenementContratCree(ID_EVT_CONTRAT, { premiereInscription: true }),
    );
    // Rejeu de la MÊME enveloppe avec un payload altéré : si la projection
    // était ré-appliquée, premiereInscription redeviendrait false.
    await expect(
      projection.traiter(
        'PLANIFICATION',
        evenementContratCree(ID_EVT_CONTRAT, { premiereInscription: false }),
      ),
    ).resolves.toBe('TRAITE');

    expect(lignesDe(contrat)).toHaveLength(1);
    expect(lignesDe(contrat)[0]).toMatchObject({ premiereInscription: true });
    expect(lignesDe(processedEvent)).toHaveLength(1);
  });
});

/**
 * Garde de **monotonie** `occurred_at` (lot 4 « Confiance & quotidien ») : un
 * événement plus ANCIEN re-livré (NAK/backoff JetStream) ne doit plus écraser un
 * état plus récent. Deux angles par handler : « désordre » (le récent T2 puis
 * l'ancien T1 ⇒ l'état reste T2) et « rattrapage » (l'ancien puis le récent ⇒
 * convergence vers T2). Les deux enveloppes ont des **ids différents** (sinon
 * l'idempotence `processed_event` masquerait la garde).
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

  const evenementGrille = (
    id: string,
    occurredAt: string,
    valideAu: string | null,
  ): unknown => ({
    id,
    type: GRILLE_PUBLIEE_TYPE,
    source: 'svc-referentiel',
    version: 1,
    occurredAt,
    traceId: 'trace-mono-g',
    payload: {
      grilleId: '44444444-0000-4000-8000-000000000000',
      mode: 'CANTINE',
      tranche: 3,
      valideDu: '2026-01-01',
      valideAu,
    },
  });

  it('FoyerMisAJour — désordre : l’ancien re-livré n’écrase pas l’état récent', async () => {
    const { db, lignesDe } = fakeBaseEnMemoire();
    const projection = new ProjectionService(db, clientMuet);

    await projection.traiter(
      'FOYER',
      avecInstant(
        evenementFoyer(ID_X, {
          ressourcesMensuellesCentimes: 500000,
          tranche: 1,
        }),
        T2,
      ),
    );
    await projection.traiter(
      'FOYER',
      avecInstant(
        evenementFoyer(ID_Y, {
          ressourcesMensuellesCentimes: 999999,
          tranche: 2,
        }),
        T1,
      ),
    );

    expect(lignesDe(foyer)[0]).toMatchObject({
      ressourcesMensuellesCentimes: 500000,
      tranche: 1,
      eventId: ID_X,
    });
    expect(lignesDe(processedEvent)).toHaveLength(2); // les deux sont consommés
  });

  it('FoyerMisAJour — rattrapage : l’ancien puis le récent convergent vers T2', async () => {
    const { db, lignesDe } = fakeBaseEnMemoire();
    const projection = new ProjectionService(db, clientMuet);

    await projection.traiter(
      'FOYER',
      avecInstant(
        evenementFoyer(ID_Y, {
          ressourcesMensuellesCentimes: 999999,
          tranche: 2,
        }),
        T1,
      ),
    );
    await projection.traiter(
      'FOYER',
      avecInstant(
        evenementFoyer(ID_X, {
          ressourcesMensuellesCentimes: 500000,
          tranche: 1,
        }),
        T2,
      ),
    );

    expect(lignesDe(foyer)[0]).toMatchObject({
      ressourcesMensuellesCentimes: 500000,
      tranche: 1,
      eventId: ID_X,
    });
  });

  it('GrillePubliee — désordre : l’ancien re-livré n’écrase pas l’état récent', async () => {
    const { db, lignesDe } = fakeBaseEnMemoire();
    const projection = new ProjectionService(db, clientMuet);

    await projection.traiter(
      'REFERENTIEL',
      evenementGrille(ID_X, T2, '2099-12-31'),
    );
    await projection.traiter(
      'REFERENTIEL',
      evenementGrille(ID_Y, T1, '2026-06-30'),
    );

    expect(lignesDe(grilleTarifaire)).toHaveLength(1);
    expect(lignesDe(grilleTarifaire)[0]).toMatchObject({
      valideAu: '2099-12-31',
      eventId: ID_X,
    });
  });

  it('GrillePubliee — rattrapage : l’ancien puis le récent convergent vers T2', async () => {
    const { db, lignesDe } = fakeBaseEnMemoire();
    const projection = new ProjectionService(db, clientMuet);

    await projection.traiter(
      'REFERENTIEL',
      evenementGrille(ID_Y, T1, '2026-06-30'),
    );
    await projection.traiter(
      'REFERENTIEL',
      evenementGrille(ID_X, T2, '2099-12-31'),
    );

    expect(lignesDe(grilleTarifaire)[0]).toMatchObject({
      valideAu: '2099-12-31',
      eventId: ID_X,
    });
  });

  it('ContratCree — désordre : l’ancien re-livré n’écrase pas l’état récent', async () => {
    const { db, lignesDe } = fakeBaseEnMemoire();
    const projection = new ProjectionService(db, clientMuet);

    await projection.traiter(
      'PLANIFICATION',
      avecInstant(
        evenementContratCree(ID_X, {
          premiereInscription: true,
          valideDu: '2026-09-01',
        }),
        T2,
      ),
    );
    await projection.traiter(
      'PLANIFICATION',
      avecInstant(
        evenementContratCree(ID_Y, {
          premiereInscription: false,
          valideDu: '2025-01-01',
        }),
        T1,
      ),
    );

    expect(lignesDe(contrat)[0]).toMatchObject({
      premiereInscription: true,
      valideDu: '2026-09-01',
      eventId: ID_X,
    });
  });

  it('ContratCree — rattrapage : l’ancien puis le récent convergent vers T2', async () => {
    const { db, lignesDe } = fakeBaseEnMemoire();
    const projection = new ProjectionService(db, clientMuet);

    await projection.traiter(
      'PLANIFICATION',
      avecInstant(
        evenementContratCree(ID_Y, {
          premiereInscription: false,
          valideDu: '2025-01-01',
        }),
        T1,
      ),
    );
    await projection.traiter(
      'PLANIFICATION',
      avecInstant(
        evenementContratCree(ID_X, {
          premiereInscription: true,
          valideDu: '2026-09-01',
        }),
        T2,
      ),
    );

    expect(lignesDe(contrat)[0]).toMatchObject({
      premiereInscription: true,
      valideDu: '2026-09-01',
      eventId: ID_X,
    });
  });

  it('ContratModifie — désordre : l’ancien re-livré n’écrase pas l’état récent', async () => {
    const { db, lignesDe } = fakeBaseEnMemoire();
    const projection = new ProjectionService(db, clientMuet);

    await projection.traiter(
      'PLANIFICATION',
      avecInstant(
        evenementContratModifie(ID_X, {
          premiereInscription: true,
          valideDu: '2026-09-01',
        }),
        T2,
      ),
    );
    await projection.traiter(
      'PLANIFICATION',
      avecInstant(
        evenementContratModifie(ID_Y, {
          premiereInscription: false,
          valideDu: '2025-01-01',
        }),
        T1,
      ),
    );

    expect(lignesDe(contrat)).toHaveLength(1);
    expect(lignesDe(contrat)[0]).toMatchObject({
      premiereInscription: true,
      valideDu: '2026-09-01',
      eventId: ID_X,
    });
  });

  it('ContratModifie — rattrapage : l’ancien puis le récent convergent vers T2', async () => {
    const { db, lignesDe } = fakeBaseEnMemoire();
    const projection = new ProjectionService(db, clientMuet);

    await projection.traiter(
      'PLANIFICATION',
      avecInstant(
        evenementContratModifie(ID_Y, {
          premiereInscription: false,
          valideDu: '2025-01-01',
        }),
        T1,
      ),
    );
    await projection.traiter(
      'PLANIFICATION',
      avecInstant(
        evenementContratModifie(ID_X, {
          premiereInscription: true,
          valideDu: '2026-09-01',
        }),
        T2,
      ),
    );

    expect(lignesDe(contrat)[0]).toMatchObject({
      premiereInscription: true,
      valideDu: '2026-09-01',
      eventId: ID_X,
    });
  });

  it('PlanningModifie — désordre : les prestations d’un événement ancien n’écrasent pas les récentes', async () => {
    const { db, lignesDe } = fakeBaseEnMemoire();
    const client = {
      prestations: vi.fn(async () => ({
        contratId: CONTRAT_ID,
        mois: MOIS,
        simule: false,
        prestations: [{ mode: 'CRECHE_PSU' as const, heuresFacturees: 9000 }],
      })),
    } as unknown as PlanificationClient;
    const projection = new ProjectionService(db, client);
    // Identité du contrat requise avant toute projection de prestations.
    await projection.traiter(
      'PLANIFICATION',
      avecInstant(
        evenementContratCree('cccccccc-3333-4333-8333-cccccccccccc'),
        '2026-08-01T00:00:00.000Z',
      ),
    );

    await projection.traiter(
      'PLANIFICATION',
      avecInstant(evenementPlanning(ID_X), T2),
    );
    await projection.traiter(
      'PLANIFICATION',
      avecInstant(evenementPlanning(ID_Y), T1),
    );

    expect(lignesDe(prestationMois)).toHaveLength(1);
    expect(lignesDe(prestationMois)[0]).toMatchObject({ eventId: ID_X });
  });

  it('PlanningModifie — rattrapage : l’ancien puis le récent convergent vers T2', async () => {
    const { db, lignesDe } = fakeBaseEnMemoire();
    const client = {
      prestations: vi.fn(async () => ({
        contratId: CONTRAT_ID,
        mois: MOIS,
        simule: false,
        prestations: [{ mode: 'CRECHE_PSU' as const, heuresFacturees: 9000 }],
      })),
    } as unknown as PlanificationClient;
    const projection = new ProjectionService(db, client);
    await projection.traiter(
      'PLANIFICATION',
      avecInstant(
        evenementContratCree('cccccccc-3333-4333-8333-cccccccccccc'),
        '2026-08-01T00:00:00.000Z',
      ),
    );

    await projection.traiter(
      'PLANIFICATION',
      avecInstant(evenementPlanning(ID_Y), T1),
    );
    await projection.traiter(
      'PLANIFICATION',
      avecInstant(evenementPlanning(ID_X), T2),
    );

    expect(lignesDe(prestationMois)).toHaveLength(1);
    expect(lignesDe(prestationMois)[0]).toMatchObject({ eventId: ID_X });
  });
});
