import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ENTETE_ASSERTION } from '@creche-planner/nest-commons';
import { PlanificationClient } from './planification.client.js';

/**
 * Relecture du planning notif→planif (diff de validation hebdo) : mapping de la
 * réponse, dégradation propre (`undefined`) si indisponible, et injection de
 * l'assertion machine inter-services (fondations lot 3). `fetch` mocké via
 * `vi.stubGlobal`. Le compteur OTel utilise l'API réelle (no-op sans SDK).
 */
function dernierEntetes(
  fetchMock: ReturnType<typeof vi.fn>,
): Record<string, string> {
  const init = fetchMock.mock.calls[0]?.[1] as {
    headers?: Record<string, string>;
  };
  return init?.headers ?? {};
}

describe('PlanificationClient (relecture notif→planif)', () => {
  let envInitial: NodeJS.ProcessEnv;

  beforeEach(() => {
    envInitial = { ...process.env };
    vi.restoreAllMocks();
  });

  afterEach(() => {
    process.env = envInitial;
  });

  it('succès → renvoie la saisie du mois', async () => {
    delete process.env['ASSERTION_IDENTITE_SECRET'];
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({
        ok: true,
        status: 200,
        json: async () => ({ saisie: { lundi: 8 } }),
      })),
    );
    const saisie = await new PlanificationClient().lirePlanning(
      'c-1',
      '2026-01',
    );
    expect(saisie).toEqual({ lundi: 8 });
  });

  it('réponse « pas de saisie » → null (distinct de undefined)', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({
        ok: true,
        status: 200,
        json: async () => ({ saisie: null }),
      })),
    );
    expect(
      await new PlanificationClient().lirePlanning('c-1', '2026-01'),
    ).toBeNull();
  });

  it('indisponible → undefined (dégradation propre)', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({ ok: false, status: 503, json: async () => ({}) })),
    );
    expect(
      await new PlanificationClient().lirePlanning('c-1', '2026-01'),
    ).toBeUndefined();
  });

  it('injecte l’assertion machine quand le secret est configuré', async () => {
    process.env['ASSERTION_IDENTITE_SECRET'] = 'secret-test';
    const fetchMock = vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ({ saisie: null }),
    }));
    vi.stubGlobal('fetch', fetchMock);
    await new PlanificationClient().lirePlanning('c-1', '2026-01');
    expect(dernierEntetes(fetchMock)[ENTETE_ASSERTION]).toBeDefined();
  });
});
