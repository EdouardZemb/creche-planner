import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ENTETE_ASSERTION } from '@creche-planner/nest-commons';
import { FoyerClient } from './foyer.client.js';

/**
 * Repli synchrone tarif→foyer : succès (parse zod), dégradation propre (`undefined`)
 * sur erreur, et injection de l'assertion **machine** inter-services (fondations lot 3)
 * quand le secret est configuré. `fetch` est mocké via `vi.stubGlobal` (modèle
 * `planification.client.spec.ts`).
 */
const FOYER_OK = {
  id: '11111111-1111-4111-8111-111111111111',
  ressourcesMensuellesCentimes: 671692,
  rfrCentimes: 7270500,
  tranche: 3,
  nbParts: 3,
  nbEnfantsACharge: 2,
};

/** En-têtes passés au dernier appel `fetch`. */
function dernierEntetes(
  fetchMock: ReturnType<typeof vi.fn>,
): Record<string, string> {
  const init = fetchMock.mock.calls[0]?.[1] as {
    headers?: Record<string, string>;
  };
  return init?.headers ?? {};
}

describe('FoyerClient (repli tarif→foyer)', () => {
  let envInitial: NodeJS.ProcessEnv;

  beforeEach(() => {
    envInitial = { ...process.env };
    vi.restoreAllMocks();
  });

  afterEach(() => {
    process.env = envInitial;
  });

  it('succès → renvoie le foyer parsé', async () => {
    delete process.env['ASSERTION_IDENTITE_SECRET'];
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({
        ok: true,
        status: 200,
        json: async () => FOYER_OK,
      })),
    );
    const resultat = await new FoyerClient().foyer('f-1');
    expect(resultat?.tranche).toBe(3);
    expect(resultat?.nbParts).toBe(3);
  });

  it('erreur HTTP → dégradation propre (undefined)', async () => {
    const client = new FoyerClient();
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({ ok: false, status: 503, json: async () => ({}) })),
    );
    expect(await client.foyer('f-1')).toBeUndefined();
  });

  it('injecte l’assertion machine quand le secret est configuré', async () => {
    process.env['ASSERTION_IDENTITE_SECRET'] = 'secret-test';
    const fetchMock = vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => FOYER_OK,
    }));
    vi.stubGlobal('fetch', fetchMock);
    await new FoyerClient().foyer('f-1');
    expect(dernierEntetes(fetchMock)[ENTETE_ASSERTION]).toBeDefined();
  });

  it('n’injecte aucune assertion sans secret (mode legacy)', async () => {
    delete process.env['ASSERTION_IDENTITE_SECRET'];
    const fetchMock = vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => FOYER_OK,
    }));
    vi.stubGlobal('fetch', fetchMock);
    await new FoyerClient().foyer('f-1');
    expect(dernierEntetes(fetchMock)[ENTETE_ASSERTION]).toBeUndefined();
  });
});
