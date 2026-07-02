import { afterEach, describe, expect, it, vi } from 'vitest';
import { ReferentielClient } from './referentiel.client.js';

/**
 * Tests du client Référentiel (fetch mocké). Le point clé est la **dégradation
 * propre** : si le Référentiel est injoignable ou renvoie une forme inattendue,
 * la lecture des prestations ne doit pas échouer → liste vide (aucune exclusion).
 */

function mockFetch(reponse: unknown): void {
  vi.stubGlobal(
    'fetch',
    vi.fn(() => Promise.resolve(reponse)),
  );
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('ReferentielClient.joursNonFacturables', () => {
  it('renvoie les dates ISO des jours non facturables', async () => {
    mockFetch({
      ok: true,
      json: () =>
        Promise.resolve([
          { jour: '2026-10-05', type: 'FERIE', libelle: 'Test' },
          { jour: '2026-10-12', type: 'FERMETURE', libelle: 'Pont' },
        ]),
    });

    const jours = await new ReferentielClient().joursNonFacturables();
    expect(jours).toEqual(['2026-10-05', '2026-10-12']);
  });

  it('dégrade en liste vide sur une réponse HTTP non-ok', async () => {
    mockFetch({ ok: false, status: 503 });

    const jours = await new ReferentielClient().joursNonFacturables();
    expect(jours).toEqual([]);
  });

  it('dégrade en liste vide si le réseau échoue', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() => Promise.reject(new Error('ECONNREFUSED'))),
    );

    const jours = await new ReferentielClient().joursNonFacturables();
    expect(jours).toEqual([]);
  });

  it('dégrade en liste vide sur un corps de forme inattendue (Zod)', async () => {
    mockFetch({ ok: true, json: () => Promise.resolve([{ pasUnJour: true }]) });

    const jours = await new ReferentielClient().joursNonFacturables();
    expect(jours).toEqual([]);
  });
});
