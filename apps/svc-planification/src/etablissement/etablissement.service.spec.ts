import { describe, expect, it, vi } from 'vitest';
import { Param } from 'drizzle-orm';
import { ConflictException, NotFoundException } from '@nestjs/common';
import {
  ETABLISSEMENT_CREE_TYPE,
  ETABLISSEMENT_MODIFIE_TYPE,
  ETABLISSEMENT_SUPPRIME_TYPE,
} from '@creche-planner/contracts-planification';
import { EtablissementService } from './etablissement.service.js';
import type { Database } from '../database/database.types.js';
import type { EtablissementRow } from '../database/schema.js';
import type {
  CreerEtablissementDto,
  ModifierEtablissementDto,
} from './etablissement.dto.js';

/**
 * Tests unitaires du `EtablissementService` SANS infra (Postgres mocké). On
 * construit `new EtablissementService(fakeDb)` avec un faux `db` chaînable
 * renvoyant des lignes canned. La projection effective (SQL réel) reste couverte
 * par la vérification Pact provider (base réelle en CI).
 */

const ETAB_ID = '99999999-9999-4999-8999-999999999999';
const FOYER_ID = '22222222-2222-4222-8222-222222222222';

/** Ligne établissement complète (défauts), surchargée à la demande. */
function ligneEtab(
  overrides: Partial<EtablissementRow> = {},
): EtablissementRow {
  return {
    id: ETAB_ID,
    foyerId: FOYER_ID,
    nom: 'Crèche du centre',
    emailService: null,
    preavisRegle: null,
    types: [],
    adresse: null,
    telephone: null,
    contact: null,
    actif: true,
    createdAt: new Date('2026-06-29T00:00:00Z'),
    updatedAt: new Date('2026-06-29T00:00:00Z'),
    ...overrides,
  };
}

/** Une valeur insérée dans l'outbox est reconnaissable à sa clé `payload`. */
function estOutbox(v: Record<string, unknown>): boolean {
  return 'payload' in v;
}

/**
 * Faux `db` transactionnel pour `creer` : `insert().values()` distingue
 * l'établissement (→ `.returning()` la ligne reflétant les valeurs) de l'outbox
 * (→ simple `await`). Capture les insertions outbox ET établissement.
 */
function fakeCreer(): {
  db: Database;
  outbox: Record<string, unknown>[];
  etab: Record<string, unknown>[];
} {
  const outbox: Record<string, unknown>[] = [];
  const etab: Record<string, unknown>[] = [];
  const tx = {
    insert: () => ({
      values: (v: Record<string, unknown>) => {
        if (estOutbox(v)) {
          outbox.push(v);
          return Promise.resolve();
        }
        etab.push(v);
        const row = ligneEtab(v);
        // Insert idempotent (Lot 3) : `.onConflictDoNothing().returning()` — ce fake
        // sans état ne simule aucun conflit (chemin nominal, ligne renvoyée).
        const returning = () => Promise.resolve([row]);
        return Object.assign(Promise.resolve(), {
          returning,
          onConflictDoNothing: () => ({ returning }),
        });
      },
    }),
  };
  const db = {
    transaction: vi.fn(async (cb: (t: unknown) => Promise<unknown>) => cb(tx)),
  } as unknown as Database;
  return { db, outbox, etab };
}

/** Faux `db` transactionnel pour `modifier`/`archiver` : `update().set().where().returning()`. */
function fakeMaj(present: boolean): {
  db: Database;
  outbox: Record<string, unknown>[];
  set: () => Record<string, unknown> | undefined;
} {
  const outbox: Record<string, unknown>[] = [];
  let setArg: Record<string, unknown> | undefined;
  const tx = {
    update: () => ({
      set: (s: Record<string, unknown>) => {
        setArg = s;
        return {
          where: () => ({
            returning: () =>
              Promise.resolve(
                present ? [ligneEtab(s as Partial<EtablissementRow>)] : [],
              ),
          }),
        };
      },
    }),
    insert: () => ({
      values: (v: Record<string, unknown>) => {
        outbox.push(v);
        return Promise.resolve();
      },
    }),
  };
  const db = {
    transaction: vi.fn(async (cb: (t: unknown) => Promise<unknown>) => cb(tx)),
  } as unknown as Database;
  return { db, outbox, set: () => setArg };
}

/**
 * Faux `db` transactionnel pour `supprimer`. Deux `select` successifs : le 1ᵉʳ
 * garde l'existence (404 si vide), le 2ᵉ **compte** les contrats rattachés
 * (`compterContratsRattaches` → garde 409). On répond donc par index d'appel :
 * existence (`[ligneEtab()]`/`[]`) puis comptage (`[{ n: nbRattaches }]`).
 * `delete()` est espionné.
 */
function fakeSuppr(
  present: boolean,
  nbRattaches = 0,
): {
  db: Database;
  outbox: Record<string, unknown>[];
  supprime: () => boolean;
} {
  const outbox: Record<string, unknown>[] = [];
  let supprime = false;
  const reponses: unknown[][] = [
    present ? [ligneEtab()] : [],
    [{ n: nbRattaches }],
  ];
  let i = 0;
  const tx = {
    select: () => ({
      from: () => ({ where: () => Promise.resolve(reponses[i++] ?? []) }),
    }),
    delete: () => ({
      where: () => {
        supprime = true;
        return Promise.resolve();
      },
    }),
    insert: () => ({
      values: (v: Record<string, unknown>) => {
        outbox.push(v);
        return Promise.resolve();
      },
    }),
  };
  const db = {
    transaction: vi.fn(async (cb: (t: unknown) => Promise<unknown>) => cb(tx)),
  } as unknown as Database;
  return { db, outbox, supprime: () => supprime };
}

/** Faux `db` pour les lectures (`lister`, `parId`). Chaîne `from().where().orderBy()`. */
function fakeLecture(...reponses: EtablissementRow[][]): Database {
  let i = 0;
  const select = vi.fn(() => {
    const lignes = reponses[i++] ?? [];
    const chaine = {
      where: vi.fn(() => Object.assign(Promise.resolve(lignes), chaine)),
      orderBy: vi.fn(() => Promise.resolve(lignes)),
      from: vi.fn(() => chaine),
    };
    return chaine;
  });
  return { select } as unknown as Database;
}

function payloadDe(ligne: Record<string, unknown>): Record<string, unknown> {
  return ligne['payload'] as Record<string, unknown>;
}

describe('EtablissementService.creer', () => {
  it('insère l’établissement + l’outbox EtablissementCree (même transaction)', async () => {
    const { db, outbox, etab } = fakeCreer();
    const service = new EtablissementService(db);

    const dto: CreerEtablissementDto = {
      nom: 'Crèche du centre',
      emailService: 'service@creche.example',
      preavisRegle: { type: 'JOURS_OUVRES', valeur: 2 },
      types: ['CRECHE_PSU', 'PERISCOLAIRE'],
    };
    const vue = await service.creer(FOYER_ID, dto);

    expect(db.transaction).toHaveBeenCalledTimes(1);
    expect(vue).toMatchObject({
      foyerId: FOYER_ID,
      nom: 'Crèche du centre',
      emailService: 'service@creche.example',
      types: ['CRECHE_PSU', 'PERISCOLAIRE'],
      actif: true,
    });
    // L'insert établissement porte le foyer et le nom.
    expect(etab[0]).toMatchObject({
      foyerId: FOYER_ID,
      nom: 'Crèche du centre',
    });
    // L'outbox porte EtablissementCree avec l'état projeté complet : l'id du
    // payload est celui de la ligne insérée (UUID généré par le service).
    expect(outbox[0]).toMatchObject({ type: ETABLISSEMENT_CREE_TYPE });
    expect(payloadDe(outbox[0]!)).toMatchObject({
      etablissementId: etab[0]!['id'],
      foyerId: FOYER_ID,
      nom: 'Crèche du centre',
      types: ['CRECHE_PSU', 'PERISCOLAIRE'],
      actif: true,
    });
  });

  it('applique les défauts (types vide, actif vrai, coordonnées nulles)', async () => {
    const { db, etab } = fakeCreer();
    const service = new EtablissementService(db);

    await service.creer(FOYER_ID, { nom: 'Sans contact' });

    expect(etab[0]).toMatchObject({
      types: [],
      actif: true,
      emailService: null,
      preavisRegle: null,
      adresse: null,
      telephone: null,
      contact: null,
    });
  });

  it('traduit une violation d’unicité (nom déjà pris) en 409', async () => {
    // `postgres` rejette avec une Error portant `code = '23505'` sur conflit d'unicité.
    const conflit = Object.assign(new Error('doublon'), { code: '23505' });
    const db = {
      transaction: vi.fn(() => Promise.reject(conflit)),
    } as unknown as Database;
    const service = new EtablissementService(db);

    await expect(
      service.creer(FOYER_ID, { nom: 'Doublon' }),
    ).rejects.toBeInstanceOf(ConflictException);
  });
});

/**
 * Faux `db` **à état** pour l'idempotence de création (Lot 3 — C1). Modélise le
 * comportement Postgres de `insert(...).onConflictDoNothing({ target: id }).returning()` :
 * - même `id` déjà présent → aucune insertion, `returning` vide (rejeu no-op) ;
 * - `id` différent mais `(foyer_id, nom)` déjà pris → **23505** (le target `id` ne
 *   suppresse pas la violation d'unicité du nom) → 409 conservé.
 * Le `select().from().where(eq(id))` du chemin de rejeu filtre le magasin par id.
 */
function fakeCreerStateful(): {
  db: Database;
  etab: Record<string, unknown>[];
  outbox: Record<string, unknown>[];
} {
  const etab: Record<string, unknown>[] = [];
  const outbox: Record<string, unknown>[] = [];
  const tx = {
    select: () => ({
      from: () => ({
        where: (condition: unknown) => {
          const chunks = (condition as { queryChunks: unknown[] }).queryChunks;
          const param = chunks.find((c) => c instanceof Param) as
            Param | undefined;
          return Promise.resolve(etab.filter((e) => e['id'] === param?.value));
        },
      }),
    }),
    insert: () => ({
      values: (v: Record<string, unknown>) => {
        if (estOutbox(v)) {
          outbox.push(v);
          return Promise.resolve();
        }
        const returning = () => {
          if (etab.some((e) => e['id'] === v['id'])) {
            return Promise.resolve([]); // rejeu même id : PK → no-op
          }
          if (
            etab.some(
              (e) => e['foyerId'] === v['foyerId'] && e['nom'] === v['nom'],
            )
          ) {
            // Vrai doublon de nom (id différent) : UNIQUE(foyer_id, nom) → 23505.
            return Promise.reject(
              Object.assign(new Error('doublon'), { code: '23505' }),
            );
          }
          etab.push({ ...v });
          return Promise.resolve([{ ...v }]);
        };
        return Object.assign(Promise.resolve(), {
          returning,
          onConflictDoNothing: () => ({ returning }),
        });
      },
    }),
  };
  const db = {
    transaction: vi.fn(async (cb: (t: unknown) => Promise<unknown>) => cb(tx)),
  } as unknown as Database;
  return { db, etab, outbox };
}

describe('EtablissementService.creer (idempotence, Lot 3 — C1)', () => {
  const ID_A = '11111111-1111-4111-8111-111111111111';
  const ID_B = '22222222-2222-4222-8222-222222222222';

  it('double création (même id) → 1 ressource, 1 seul EtablissementCree, même vue', async () => {
    const { db, etab, outbox } = fakeCreerStateful();
    const service = new EtablissementService(db);
    const dto: CreerEtablissementDto = { id: ID_A, nom: 'Crèche du centre' };

    const vue1 = await service.creer(FOYER_ID, dto);
    const vue2 = await service.creer(FOYER_ID, dto);

    expect(etab).toHaveLength(1);
    expect(
      outbox.filter((o) => o['type'] === ETABLISSEMENT_CREE_TYPE),
    ).toHaveLength(1);
    expect(vue2).toEqual(vue1);
    expect(vue1).toMatchObject({ id: ID_A, nom: 'Crèche du centre' });
  });

  it('id différent + même nom → 409 conservé (vrai doublon), rien de créé ni émis en plus', async () => {
    const { db, etab, outbox } = fakeCreerStateful();
    const service = new EtablissementService(db);
    await service.creer(FOYER_ID, { id: ID_A, nom: 'Doublon' });

    await expect(
      service.creer(FOYER_ID, { id: ID_B, nom: 'Doublon' }),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(etab).toHaveLength(1);
    expect(
      outbox.filter((o) => o['type'] === ETABLISSEMENT_CREE_TYPE),
    ).toHaveLength(1);
  });
});

describe('EtablissementService.modifier', () => {
  it('ne met à jour que les champs fournis + émet EtablissementModifie', async () => {
    const { db, outbox, set } = fakeMaj(true);
    const service = new EtablissementService(db);

    const dto: ModifierEtablissementDto = { nom: 'Renommée' };
    await service.modifier(ETAB_ID, dto);

    const s = set();
    expect(s).toMatchObject({ nom: 'Renommée' });
    // Champs non fournis absents du SET (seul `updatedAt` s'ajoute systématiquement).
    expect(s).not.toHaveProperty('types');
    expect(s).not.toHaveProperty('emailService');
    expect(s).toHaveProperty('updatedAt');
    expect(outbox[0]).toMatchObject({ type: ETABLISSEMENT_MODIFIE_TYPE });
  });

  it('un emailService explicitement null vide le champ', async () => {
    const { db, set } = fakeMaj(true);
    const service = new EtablissementService(db);

    await service.modifier(ETAB_ID, { emailService: null });

    expect(set()).toMatchObject({ emailService: null });
  });

  it('lève NotFoundException si l’établissement est introuvable (rien d’émis)', async () => {
    const { db, outbox } = fakeMaj(false);
    const service = new EtablissementService(db);

    await expect(
      service.modifier(ETAB_ID, { nom: 'X' }),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(outbox).toHaveLength(0);
  });
});

describe('EtablissementService.archiver', () => {
  it('passe actif=false + émet EtablissementModifie', async () => {
    const { db, outbox, set } = fakeMaj(true);
    const service = new EtablissementService(db);

    const vue = await service.archiver(ETAB_ID);

    expect(set()).toMatchObject({ actif: false });
    expect(vue.actif).toBe(false);
    expect(outbox[0]).toMatchObject({ type: ETABLISSEMENT_MODIFIE_TYPE });
  });

  it('lève NotFoundException si l’établissement est introuvable', async () => {
    const { db } = fakeMaj(false);
    const service = new EtablissementService(db);
    await expect(service.archiver(ETAB_ID)).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });
});

describe('EtablissementService.supprimer', () => {
  it('supprime + émet EtablissementSupprime (même transaction)', async () => {
    const { db, outbox, supprime } = fakeSuppr(true);
    const service = new EtablissementService(db);

    await service.supprimer(ETAB_ID);

    expect(supprime()).toBe(true);
    expect(outbox[0]).toMatchObject({ type: ETABLISSEMENT_SUPPRIME_TYPE });
    expect(payloadDe(outbox[0]!)).toEqual({ etablissementId: ETAB_ID });
  });

  it('lève NotFoundException si introuvable, sans supprimer ni émettre', async () => {
    const { db, outbox, supprime } = fakeSuppr(false);
    const service = new EtablissementService(db);

    await expect(service.supprimer(ETAB_ID)).rejects.toBeInstanceOf(
      NotFoundException,
    );
    expect(supprime()).toBe(false);
    expect(outbox).toHaveLength(0);
  });

  it('GARDE (P2) : bloque en 409 si des contrats sont rattachés, sans supprimer ni émettre', async () => {
    // Le comptage réel (`compterContratsRattaches`) renvoie 2 via le 2ᵉ select.
    const { db, outbox, supprime } = fakeSuppr(true, 2);
    const service = new EtablissementService(db);

    await expect(service.supprimer(ETAB_ID)).rejects.toBeInstanceOf(
      ConflictException,
    );
    expect(supprime()).toBe(false);
    expect(outbox).toHaveLength(0);
  });
});

describe('EtablissementService.lister / parId', () => {
  it('liste les établissements d’un foyer en EtablissementVue', async () => {
    const db = fakeLecture([
      ligneEtab({ nom: 'A', types: ['CRECHE_PSU'] }),
      ligneEtab({ id: '88888888-8888-4888-8888-888888888888', nom: 'B' }),
    ]);
    const service = new EtablissementService(db);

    const vues = await service.lister(FOYER_ID);
    expect(vues).toHaveLength(2);
    expect(vues[0]).toMatchObject({ nom: 'A', types: ['CRECHE_PSU'] });
  });

  it('parId renvoie la vue si présent', async () => {
    const db = fakeLecture([ligneEtab({ nom: 'Cible' })]);
    const service = new EtablissementService(db);
    const vue = await service.parId(ETAB_ID);
    expect(vue).toMatchObject({ id: ETAB_ID, nom: 'Cible' });
  });

  it('parId lève NotFoundException si absent', async () => {
    const db = fakeLecture([]);
    const service = new EtablissementService(db);
    await expect(service.parId(ETAB_ID)).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });
});
