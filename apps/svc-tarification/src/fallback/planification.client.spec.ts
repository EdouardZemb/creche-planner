import { beforeEach, describe, expect, it, vi } from 'vitest';
import { PlanificationClient } from './planification.client.js';

/**
 * DEC-05/CA1 : chaque usage effectif du repli synchrone tarif→planif incrémente le
 * compteur Prometheus `tarification_repli_planification_total`. On isole le compteur
 * en mockant l'API OTel `@opentelemetry/api` (dépendance directe de svc-tarification)
 * pour vérifier l'incrément sans câbler un MeterProvider/SDK métriques.
 *
 * On vérifie aussi (CA3) que l'instrumentation n'altère pas le comportement : le repli
 * renvoie bien la valeur parsée en succès et `undefined` en dégradation propre.
 *
 * `vi.hoisted` expose le mock `add` au factory `vi.mock` (hissé au-dessus des imports)
 * — évite un `await import()` top-level (interdit en CJS, TS1309).
 */

const { add } = vi.hoisted(() => ({ add: vi.fn() }));

vi.mock('@opentelemetry/api', () => ({
  metrics: {
    getMeter: () => ({
      createCounter: () => ({ add }),
    }),
  },
}));

const REPONSE_OK = {
  contratId: 'c-1',
  mois: '2026-01',
  simule: false,
  prestations: [{ mode: 'CRECHE_PSU', minutes: 600 }],
};

describe('PlanificationClient — instrumentation du repli (DEC-05)', () => {
  beforeEach(() => {
    add.mockClear();
    vi.restoreAllMocks();
  });

  it('incrémente le compteur de repli à chaque appel, avec le tag simule', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({
        ok: true,
        status: 200,
        json: async () => REPONSE_OK,
      })),
    );

    const client = new PlanificationClient();
    const resultat = await client.prestations('c-1', '2026-01', false);

    // CA1 : exactement un incrément par usage du repli, taggé par `simule`.
    expect(add).toHaveBeenCalledTimes(1);
    expect(add).toHaveBeenCalledWith(1, { simule: false });
    // CA3 : comportement fonctionnel inchangé (valeur parsée renvoyée).
    expect(resultat?.prestations[0]?.mode).toBe('CRECHE_PSU');
  });

  it('incrémente le compteur même quand le repli échoue (dégradation propre)', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({
        ok: false,
        status: 503,
        json: async () => ({}),
      })),
    );

    const client = new PlanificationClient();
    const resultat = await client.prestations('c-1', '2026-01', true);

    // L'incrément mesure la fréquence du repli, indépendamment de son issue.
    expect(add).toHaveBeenCalledTimes(1);
    expect(add).toHaveBeenCalledWith(1, { simule: true });
    // Dégradation propre : aucune exception propagée, valeur de repli `undefined`.
    expect(resultat).toBeUndefined();
  });
});
