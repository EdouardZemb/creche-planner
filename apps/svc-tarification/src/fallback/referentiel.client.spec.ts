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
  // `| undefined` explicite : `calls[0]` peut ne pas exister (aucun appel émis).
  // Sans lui, le cast mentait et rendait l'accès optionnel ci-dessous « inutile ».
  const init = fetchMock.mock.calls[0]?.[1] as
    { headers?: Record<string, string> } | undefined;
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

  it('baremePsuApplicable : succès → renvoie taux + bornes (repli PSU à date)', async () => {
    delete process.env['ASSERTION_IDENTITE_SECRET'];
    const fetchMock = vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ({
        mode: 'CRECHE_PSU',
        valideDu: '2026-01-01',
        valideAu: null,
        taux: { '1': 0.000619, '2': 0.000516 },
        plancherCentimes: null,
        plafondCentimes: null,
      }),
    }));
    vi.stubGlobal('fetch', fetchMock);
    const bareme = await new ReferentielClient().baremePsuApplicable(
      '2026-09-15',
    );
    expect(bareme?.taux).toEqual({ '1': 0.000619, '2': 0.000516 });
    // La requête cible bien le mode CRECHE_PSU sans tranche.
    const url = (fetchMock.mock.calls[0] as unknown[] | undefined)?.[0];
    expect(String(url)).toContain('mode=CRECHE_PSU');
  });

  it('baremePsuApplicable : erreur HTTP → dégradation propre (undefined)', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({ ok: false, status: 503, json: async () => ({}) })),
    );
    expect(
      await new ReferentielClient().baremePsuApplicable('2026-09-15'),
    ).toBeUndefined();
  });
});
