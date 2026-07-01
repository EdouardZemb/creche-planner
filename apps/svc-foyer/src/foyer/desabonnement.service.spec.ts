import { describe, expect, it, vi } from 'vitest';
import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import { PREFERENCES_NOTIF_MODIFIEES_TYPE } from '@creche-planner/contracts-foyer';
import { DesabonnementService } from './desabonnement.service.js';
import { signerJeton, verifierJeton } from './desabonnement.jeton.js';
import type { Database } from '../database/database.types.js';
import {
  desabonnementToken,
  outbox,
  parent,
  preferenceNotification,
  type DesabonnementTokenRow,
  type PreferenceNotificationRow,
} from '../database/schema.js';

/**
 * Tests unitaires du `DesabonnementService` SANS infra (Postgres mocké), même motif
 * que `foyer.service.spec.ts` : un faux `db` aux chaînes Drizzle espionnables,
 * discriminées **par table**. Cible les invariants de sécurité RFC 8058 : jeton
 * expiré/rejoué (one-shot), refus du dernier canal d'un service (409), absence
 * d'énumération (erreur générique, base non sollicitée).
 */

const SECRET = 'secret-de-test';
const OPTIONS = { secret: SECRET, ttlJours: 30 };
const FOYER_ID = '22222222-2222-4222-8222-222222222222';
const PARENT_ID = '33333333-3333-4333-8333-333333333333';
const JTI = '11111111-1111-4111-8111-111111111111';
const FUTUR = new Date('2027-01-01T00:00:00Z');
const EXP_FUTUR = Math.floor(FUTUR.getTime() / 1000);

function ligneToken(
  overrides: Partial<DesabonnementTokenRow> = {},
): DesabonnementTokenRow {
  return {
    jti: JTI,
    parentId: PARENT_ID,
    typeNotification: 'VALIDATION_HEBDO',
    canal: 'EMAIL',
    emisLe: new Date('2026-07-01T00:00:00Z'),
    utiliseLe: null,
    expireLe: FUTUR,
    ...overrides,
  };
}

function lignePref(
  overrides: Partial<PreferenceNotificationRow> = {},
): PreferenceNotificationRow {
  return {
    id: 'p-1',
    parentId: PARENT_ID,
    typeNotification: 'VALIDATION_HEBDO',
    canal: 'IN_APP',
    actif: true,
    consentementAt: null,
    desabonneAt: null,
    sourceDernier: 'ECRAN',
    createdAt: new Date('2026-07-01T00:00:00Z'),
    updatedAt: new Date('2026-07-01T00:00:00Z'),
    ...overrides,
  };
}

interface FakeDb {
  db: Database;
  transaction: ReturnType<typeof vi.fn>;
  inserts: { table: unknown; values: Record<string, unknown> }[];
  updates: { table: unknown; set: Record<string, unknown> }[];
}

/**
 * Faux `db` discriminant `select().from(table)` par identité de table (jetons /
 * parents / préférences). `transaction(cb)` réutilise le même `db` comme client
 * transactionnel. `update().set().where().returning()` renvoie `claimRows` (prise
 * one-shot du jeton). Inserts/updates capturés pour assertions.
 */
function fakeDb(opts: {
  parentRows?: { foyerId?: string; id?: string }[];
  tokenRows?: DesabonnementTokenRow[];
  prefRows?: PreferenceNotificationRow[];
  claimRows?: { jti: string }[];
}): FakeDb {
  const inserts: { table: unknown; values: Record<string, unknown> }[] = [];
  const updates: { table: unknown; set: Record<string, unknown> }[] = [];
  const rowsFor = (table: unknown): unknown[] => {
    if (table === desabonnementToken) return opts.tokenRows ?? [];
    if (table === parent) return opts.parentRows ?? [];
    if (table === preferenceNotification) return opts.prefRows ?? [];
    return [];
  };
  const select = vi.fn(() => ({
    from: (table: unknown) => ({
      where: () => Promise.resolve(rowsFor(table)),
    }),
  }));
  const insert = vi.fn((table: unknown) => ({
    values: (v: Record<string, unknown>) => {
      inserts.push({ table, values: v });
      return Object.assign(Promise.resolve(), {
        onConflictDoUpdate: () => Promise.resolve(),
      });
    },
  }));
  const update = vi.fn((table: unknown) => ({
    set: (s: Record<string, unknown>) => ({
      where: () => ({
        returning: () => {
          updates.push({ table, set: s });
          return Promise.resolve(opts.claimRows ?? [{ jti: JTI }]);
        },
      }),
    }),
  }));
  const dbObj: {
    select: typeof select;
    insert: typeof insert;
    update: typeof update;
    transaction?: ReturnType<typeof vi.fn>;
  } = { select, insert, update };
  const transaction = vi.fn(async (cb: (t: unknown) => Promise<unknown>) =>
    cb(dbObj as unknown as Database),
  );
  dbObj.transaction = transaction;
  return { db: dbObj as unknown as Database, transaction, inserts, updates };
}

describe('DesabonnementService.emettreJeton', () => {
  it('insère une ligne desabonnement_token (utilise_le NULL) et renvoie un jeton vérifiable', async () => {
    const { db, inserts } = fakeDb({ parentRows: [{ id: PARENT_ID }] });
    const service = new DesabonnementService(db, OPTIONS);

    const { token } = await service.emettreJeton({
      foyerId: FOYER_ID,
      parentId: PARENT_ID,
      typeNotification: 'VALIDATION_HEBDO',
      canal: 'EMAIL',
    });

    const charge = verifierJeton(token, SECRET, new Date());
    expect(charge).not.toBeNull();
    const ligne = inserts.find((i) => i.table === desabonnementToken);
    expect(ligne?.values).toMatchObject({
      jti: charge?.jti,
      parentId: PARENT_ID,
      typeNotification: 'VALIDATION_HEBDO',
      canal: 'EMAIL',
      utiliseLe: null,
    });
  });

  it('404 si le parent n’appartient pas au foyer (aucune ligne insérée)', async () => {
    const { db, inserts } = fakeDb({ parentRows: [] });
    const service = new DesabonnementService(db, OPTIONS);

    await expect(
      service.emettreJeton({
        foyerId: FOYER_ID,
        parentId: PARENT_ID,
        typeNotification: 'VALIDATION_HEBDO',
        canal: 'EMAIL',
      }),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(inserts).toHaveLength(0);
  });
});

describe('DesabonnementService.consommer', () => {
  it('jeton invalide : erreur générique SANS solliciter la base (pas d’énumération)', async () => {
    const { db, transaction } = fakeDb({});
    const service = new DesabonnementService(db, OPTIONS);

    await expect(service.consommer('jeton-forge')).rejects.toBeInstanceOf(
      BadRequestException,
    );
    // La signature est rejetée avant toute transaction : aucune fuite d'existence.
    expect(transaction).not.toHaveBeenCalled();
  });

  it('jeton expiré : erreur générique (rejeté par la signature)', async () => {
    const { db, transaction } = fakeDb({});
    const service = new DesabonnementService(db, OPTIONS);
    const expire = signerJeton(
      { jti: JTI, exp: Math.floor(Date.parse('2020-01-01') / 1000) },
      SECRET,
    );

    await expect(service.consommer(expire)).rejects.toBeInstanceOf(
      BadRequestException,
    );
    expect(transaction).not.toHaveBeenCalled();
  });

  it('jeton déjà utilisé (one-shot) : refus, aucune préférence modifiée', async () => {
    const { db, inserts, updates } = fakeDb({
      tokenRows: [ligneToken({ utiliseLe: new Date('2026-07-01T10:00:00Z') })],
    });
    const service = new DesabonnementService(db, OPTIONS);
    const token = signerJeton({ jti: JTI, exp: EXP_FUTUR }, SECRET);

    await expect(service.consommer(token)).rejects.toBeInstanceOf(
      BadRequestException,
    );
    expect(inserts).toHaveLength(0);
    expect(updates).toHaveLength(0);
  });

  it('dernier canal d’un type de service : 409, jeton NON consommé', async () => {
    // Seul l'in-app reste, explicitement inactif ⇒ couper l'e-mail rendrait
    // VALIDATION_HEBDO injoignable ⇒ refus (409) sans consommer le jeton.
    const { db, inserts, updates } = fakeDb({
      tokenRows: [ligneToken({ canal: 'EMAIL' })],
      parentRows: [{ foyerId: FOYER_ID }],
      prefRows: [lignePref({ canal: 'IN_APP', actif: false })],
    });
    const service = new DesabonnementService(db, OPTIONS);
    const token = signerJeton({ jti: JTI, exp: EXP_FUTUR }, SECRET);

    await expect(service.consommer(token)).rejects.toBeInstanceOf(
      ConflictException,
    );
    expect(updates).toHaveLength(0); // jeton pas marqué utilisé
    expect(inserts).toHaveLength(0); // aucune préférence coupée, aucun événement
  });

  it('cas nominal : coupe l’e-mail, marque le jeton utilisé et émet l’événement', async () => {
    // Aucune préférence stockée ⇒ défauts (e-mail + in-app actifs) : couper
    // l'e-mail laisse l'in-app ⇒ autorisé.
    const { db, inserts, updates } = fakeDb({
      tokenRows: [ligneToken({ canal: 'EMAIL' })],
      parentRows: [{ foyerId: FOYER_ID }],
      prefRows: [],
    });
    const service = new DesabonnementService(db, OPTIONS);
    const token = signerJeton({ jti: JTI, exp: EXP_FUTUR }, SECRET);

    await service.consommer(token);

    // Prise one-shot du jeton (update utilise_le sur desabonnement_token).
    expect(updates.some((u) => u.table === desabonnementToken)).toBe(true);
    // Opt-out matérialisé : actif=false, origine LIEN_DESABO.
    const prefIns = inserts.find((i) => i.table === preferenceNotification);
    expect(prefIns?.values).toMatchObject({
      parentId: PARENT_ID,
      typeNotification: 'VALIDATION_HEBDO',
      canal: 'EMAIL',
      actif: false,
      sourceDernier: 'LIEN_DESABO',
    });
    // Événement d'état complet émis dans la même transaction (outbox).
    const evt = inserts.find((i) => i.table === outbox);
    expect(evt?.values['type']).toBe(PREFERENCES_NOTIF_MODIFIEES_TYPE);
    expect(evt?.values['payload']).toMatchObject({
      foyerId: FOYER_ID,
      parentId: PARENT_ID,
    });
  });
});
