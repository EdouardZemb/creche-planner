import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ENTETE_ASSERTION } from '@creche-planner/nest-commons';
import { ReferentielClient } from './referentiel.client.js';

/**
 * Repli synchrone tarif→référentiel : succès (parse passthrough), dégradation propre
 * (`undefined`) sur erreur, et injection de l'assertion machine (fondations lot 3).
 */
const GRILLE_OK = {
  mode: 'CRECHE_PSU',
  tranche: 3,
  valideDu: '2026-01-01',
  valideAu: null,
  taux: 0.06,
};

function dernierEntetes(
  fetchMock: ReturnType<typeof vi.fn>,
): Record<string, string> {
  const init = fetchMock.mock.calls[0]?.[1] as {
    headers?: Record<string, string>;
  };
  return init?.headers ?? {};
}

describe('ReferentielClient (repli tarif→référentiel)', () => {
  let envInitial: NodeJS.ProcessEnv;

  beforeEach(() => {
    envInitial = { ...process.env };
    vi.restoreAllMocks();
  });

  afterEach(() => {
    process.env = envInitial;
  });

  it('succès → renvoie la grille applicable (paramètres bruts conservés)', async () => {
    delete process.env['ASSERTION_IDENTITE_SECRET'];
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({
        ok: true,
        status: 200,
        json: async () => GRILLE_OK,
      })),
    );
    const grille = await new ReferentielClient().grilleApplicable(
      '2026-09-15',
      3,
      'CRECHE_PSU',
    );
    expect(grille?.mode).toBe('CRECHE_PSU');
    expect(grille?.['taux']).toBe(0.06);
  });

  it('erreur HTTP → dégradation propre (undefined)', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({ ok: false, status: 500, json: async () => ({}) })),
    );
    expect(
      await new ReferentielClient().grilleApplicable(
        '2026-09-15',
        1,
        'CANTINE',
      ),
    ).toBeUndefined();
  });

  it('injecte l’assertion machine quand le secret est configuré', async () => {
    process.env['ASSERTION_IDENTITE_SECRET'] = 'secret-test';
    const fetchMock = vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => GRILLE_OK,
    }));
    vi.stubGlobal('fetch', fetchMock);
    await new ReferentielClient().grilleApplicable(
      '2026-09-15',
      3,
      'CRECHE_PSU',
    );
    expect(dernierEntetes(fetchMock)[ENTETE_ASSERTION]).toBeDefined();
  });
});
