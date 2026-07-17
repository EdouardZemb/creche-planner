import { afterEach, describe, expect, it, vi } from 'vitest';
import { Logger } from '@nestjs/common';
import { MODES_ABCM_CONTRAT } from '@creche-planner/contracts-referentiel';
import { SeedService } from './seed.service.js';
import { ReferentielService } from './referentiel.service.js';
import type { Database } from '../database/database.types.js';
import {
  baremePsu,
  grilleAbcm,
  jourNonFacturable,
} from '../database/schema.js';

/**
 * Tests unitaires du `SeedService` (amorçage du catalogue au boot) SANS infra.
 * On couvre les invariants d'exploitation : **idempotence** (une table déjà
 * remplie → aucune réinsertion), insertion des 3 grilles `GRILLES_2026` + barème
 * PSU + jours non facturables au premier boot, **résilience** (retry 5 s si la base
 * n'est pas prête), et le fait que les grilles seedées passent par le service qui
 * les **valide** (parse Zod déplacé du pipe HTTP vers `publierGrilleAbcm`).
 *
 * Le seed des frais fixes a été retiré (chantier « Fondations backend », lot 5 :
 * table `frais_fixes_abcm` supprimée) — aucun test ne l'attend plus.
 */

/** Accès à la méthode privée `amorcer()` pour piloter une tentative complète. */
function amorcer(seed: SeedService): Promise<void> {
  return (seed as unknown as { amorcer(): Promise<void> }).amorcer();
}

/**
 * Faux `ReferentielService` : `publier` (espion autonome, pour éviter le
 * `unbound-method` d'un `expect(obj.methode)`) est renvoyé à part du service.
 */
function fauxReferentiel(): {
  referentiel: ReferentielService;
  publier: ReturnType<typeof vi.fn>;
} {
  const publier = vi.fn(() => Promise.resolve());
  return {
    referentiel: {
      publierGrilleAbcm: publier,
    } as unknown as ReferentielService,
    publier,
  };
}

/**
 * Faux `db` pour les checks du seed : `select().from(table).limit(1)` renvoie une
 * ligne factice si `remplies` marque la table comme déjà peuplée, sinon `[]`.
 * `insert(table).values(...)` est espionné (une seule fonction `values` partagée,
 * l'ordre des appels — PSU puis fermetures — est déterministe).
 */
function fauxDbSeed(
  remplies: { grilles?: boolean; psu?: boolean; jours?: boolean } = {},
): {
  db: Database;
  insert: ReturnType<typeof vi.fn>;
  insertValues: ReturnType<typeof vi.fn>;
} {
  const rowsFor = (table: unknown): unknown[] => {
    if (table === grilleAbcm) return remplies.grilles ? [{ id: 'x' }] : [];
    if (table === baremePsu) return remplies.psu ? [{ id: 'x' }] : [];
    if (table === jourNonFacturable) return remplies.jours ? [{ id: 'x' }] : [];
    return [];
  };
  const insertValues = vi.fn(() => Promise.resolve());
  const insert = vi.fn(() => ({ values: insertValues }));
  const select = vi.fn(() => ({
    from: (table: unknown) => ({
      limit: () => Promise.resolve(rowsFor(table)),
    }),
  }));
  const db = { select, insert } as unknown as Database;
  return { db, insert, insertValues };
}

afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe('SeedService — idempotence', () => {
  it('toutes les tables déjà peuplées → skip complet (aucune écriture)', async () => {
    vi.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
    const { db, insert } = fauxDbSeed({
      grilles: true,
      psu: true,
      jours: true,
    });
    const { referentiel, publier } = fauxReferentiel();
    const seed = new SeedService(db, referentiel);

    await amorcer(seed);

    expect(publier).not.toHaveBeenCalled();
    expect(insert).not.toHaveBeenCalled();
  });
});

describe('SeedService — premier boot (tables vides)', () => {
  it('insère les 3 grilles GRILLES_2026 (T1/T2/T3) + barème PSU + jours non facturables', async () => {
    vi.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
    const { db, insert, insertValues } = fauxDbSeed();
    const { referentiel, publier } = fauxReferentiel();
    const seed = new SeedService(db, referentiel);

    await amorcer(seed);

    // 3 grilles publiées via le service, une par tranche.
    expect(publier).toHaveBeenCalledTimes(3);
    const tranches = publier.mock.calls.map(
      (appel) => (appel[0] as { tranche: number }).tranche,
    );
    expect(tranches).toEqual([1, 2, 3]);

    // Barème PSU d'abord, puis jours non facturables (ordre déterministe).
    expect(insert).toHaveBeenNthCalledWith(1, baremePsu);
    expect(insert).toHaveBeenNthCalledWith(2, jourNonFacturable);

    const psuPayload = insertValues.mock.calls[0]?.[0] as { taux: unknown };
    expect(psuPayload).toMatchObject({ valideDu: '2026-01-01' });
    expect(psuPayload.taux).toBeTypeOf('object');

    const jours = insertValues.mock.calls[1]?.[0] as readonly {
      type: string;
    }[];
    expect(Array.isArray(jours)).toBe(true);
    expect(jours.length).toBeGreaterThan(0);
    expect(jours.every((j) => j.type === 'FERMETURE_CRECHE')).toBe(true);
  });
});

describe('SeedService — résilience (base indisponible)', () => {
  it("réessaie l'amorçage 5 s plus tard si la base n'est pas prête", async () => {
    vi.useFakeTimers();
    vi.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
    const warn = vi
      .spyOn(Logger.prototype, 'warn')
      .mockImplementation(() => undefined);

    // 1re tentative : `select()` lève ; les suivantes réussissent (base prête).
    let appels = 0;
    const insert = vi.fn(() => ({ values: vi.fn(() => Promise.resolve()) }));
    const select = vi.fn(() => {
      appels += 1;
      if (appels === 1) {
        throw new Error('base indisponible');
      }
      return { from: () => ({ limit: () => Promise.resolve([]) }) };
    });
    const db = { select, insert } as unknown as Database;
    const { referentiel, publier } = fauxReferentiel();
    const seed = new SeedService(db, referentiel);

    await amorcer(seed); // tentative 1 → échec capté + retry programmé
    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining('nouvel essai dans 5 s'),
    );
    expect(publier).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(5000); // le retry s'exécute
    expect(publier).toHaveBeenCalledTimes(3);
  });

  it('onApplicationShutdown annule un retry en attente (pas de nouvelle tentative)', async () => {
    vi.useFakeTimers();
    vi.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
    vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);

    const select = vi.fn(() => {
      throw new Error('base indisponible');
    });
    const db = { select } as unknown as Database;
    const { referentiel, publier } = fauxReferentiel();
    const seed = new SeedService(db, referentiel);

    await amorcer(seed); // programme un retry
    seed.onApplicationShutdown(); // l'annule
    await vi.advanceTimersByTimeAsync(5000);

    expect(publier).not.toHaveBeenCalled();
  });

  it('onApplicationShutdown sans retry en attente est un no-op', () => {
    const { db } = fauxDbSeed();
    const seed = new SeedService(db, fauxReferentiel().referentiel);
    expect(() => {
      seed.onApplicationShutdown();
    }).not.toThrow();
  });
});

describe('SeedService — validation Zod des grilles seedées', () => {
  it('publie les 3 grilles via le VRAI service (parse Zod en tête) — données valides acceptées', async () => {
    vi.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);

    // `db` awaitable sur `.limit()` (checks du seed) ET `.where()` (publication).
    const insertValues = vi.fn(() => Promise.resolve());
    const tx = { insert: () => ({ values: insertValues }) };
    const transaction = vi.fn(async (cb: (t: unknown) => Promise<unknown>) =>
      cb(tx),
    );
    const insert = vi.fn(() => ({ values: vi.fn(() => Promise.resolve()) }));
    const select = vi.fn(() => ({
      from: () => ({
        limit: () => Promise.resolve([]),
        where: () => Promise.resolve([]),
      }),
    }));
    const db = { select, transaction, insert } as unknown as Database;

    const referentiel = new ReferentielService(db);
    const seed = new SeedService(db, referentiel);

    await amorcer(seed);

    // 3 grilles réelles publiées SANS rejet du parse → GRILLES_2026 valides.
    expect(transaction).toHaveBeenCalledTimes(3);
    // Chaque publication insère la grille + un événement outbox par mode ABCM.
    expect(insertValues).toHaveBeenCalledTimes(
      3 * (1 + MODES_ABCM_CONTRAT.length),
    );
  });
});
