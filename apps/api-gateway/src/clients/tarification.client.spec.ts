import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ENTETE_ASSERTION } from '@creche-planner/nest-commons/security';
import { TarificationClient } from './tarification.client.js';

/**
 * Client résilient gateway→svc-tarification (fondations lot 6) : `cout` et
 * `coutAnnuel` — succès, erreur HTTP, timeout via `executerResilient` (fake
 * timers, comme `libs/resilience/src/lib/resilience.spec.ts`). `coutAnnuel`
 * tourne **sans retry** (`OPTIONS_ANNUEL.retries = 0`), ce qui simplifie son
 * scénario de timeout (un seul essai). On vérifie aussi (fondations lot 3) que
 * l'assertion d'identité (`entetesAval()`) est propagée sur les appels
 * sortants. `fetch` est mocké via `vi.stubGlobal`.
 */

const COUT_MOIS_OK = {
  foyerId: 'f-1',
  mois: '2026-01',
  simule: false,
  totalCentimes: 15000,
  prestations: [],
  lignes: [],
};

const COUT_ANNUEL_OK = {
  foyerId: 'f-1',
  annee: 2026,
  simule: false,
  totalCentimes: 180000,
  mois: [],
};

function dernierEntetes(
  fetchMock: ReturnType<typeof vi.fn>,
): Record<string, string> {
  const init = fetchMock.mock.calls[0]?.[1] as {
    headers?: Record<string, string>;
  };
  return init?.headers ?? {};
}

/** `fetch` qui ne se résout jamais tant que le signal d'abandon n'est pas déclenché. */
function fetchQuiTimeoutToujours(): ReturnType<typeof vi.fn> {
  return vi.fn(
    (_url: string, init?: RequestInit) =>
      new Promise((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => {
          reject(new Error('aborted'));
        });
      }),
  );
}

describe('TarificationClient (gateway→svc-tarification)', () => {
  let envInitial: NodeJS.ProcessEnv;

  beforeEach(() => {
    envInitial = { ...process.env };
  });

  afterEach(() => {
    process.env = envInitial;
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  describe('cout', () => {
    it('succès → renvoie le coût du mois parsé', async () => {
      vi.stubGlobal(
        'fetch',
        vi.fn(async () => ({
          ok: true,
          status: 200,
          json: async () => COUT_MOIS_OK,
        })),
      );
      const cout = await new TarificationClient().cout('f-1', '2026-01', false);
      expect(cout.totalCentimes).toBe(15000);
    });

    it('erreur HTTP → propage Error(HTTP <code>)', async () => {
      vi.stubGlobal(
        'fetch',
        vi.fn(async () => ({ ok: false, status: 503, json: async () => ({}) })),
      );
      await expect(
        new TarificationClient().cout('f-1', '2026-01', false),
      ).rejects.toThrow('HTTP 503');
    });

    it('timeout → rejette après épuisement des tentatives (executerResilient)', async () => {
      vi.useFakeTimers();
      try {
        const fetchMock = fetchQuiTimeoutToujours();
        vi.stubGlobal('fetch', fetchMock);
        const promesse = new TarificationClient().cout('f-1', '2026-01', false);
        const assertion = expect(promesse).rejects.toThrow('aborted');
        // 1er essai (2000 ms) + pause entre essais (200 ms) + 2e essai (2000 ms).
        await vi.advanceTimersByTimeAsync(4300);
        await assertion;
        expect(fetchMock).toHaveBeenCalledTimes(2);
      } finally {
        vi.useRealTimers();
      }
    });

    it('injecte l’assertion d’identité sur l’appel sortant', async () => {
      process.env['ASSERTION_IDENTITE_SECRET'] = 'secret-test';
      const fetchMock = vi.fn(async () => ({
        ok: true,
        status: 200,
        json: async () => COUT_MOIS_OK,
      }));
      vi.stubGlobal('fetch', fetchMock);
      await new TarificationClient().cout('f-1', '2026-01', false);
      expect(dernierEntetes(fetchMock)[ENTETE_ASSERTION]).toBeDefined();
    });
  });

  describe('coutAnnuel', () => {
    it('succès → renvoie le coût annuel parsé', async () => {
      vi.stubGlobal(
        'fetch',
        vi.fn(async () => ({
          ok: true,
          status: 200,
          json: async () => COUT_ANNUEL_OK,
        })),
      );
      const cout = await new TarificationClient().coutAnnuel(
        'f-1',
        2026,
        false,
      );
      expect(cout.totalCentimes).toBe(180000);
    });

    it('erreur HTTP → propage Error(HTTP <code>)', async () => {
      vi.stubGlobal(
        'fetch',
        vi.fn(async () => ({ ok: false, status: 502, json: async () => ({}) })),
      );
      await expect(
        new TarificationClient().coutAnnuel('f-1', 2026, false),
      ).rejects.toThrow('HTTP 502');
    });

    it('timeout → rejette (sans retry, OPTIONS_ANNUEL.retries = 0)', async () => {
      vi.useFakeTimers();
      try {
        const fetchMock = fetchQuiTimeoutToujours();
        vi.stubGlobal('fetch', fetchMock);
        const promesse = new TarificationClient().coutAnnuel(
          'f-1',
          2026,
          false,
        );
        const assertion = expect(promesse).rejects.toThrow('aborted');
        await vi.advanceTimersByTimeAsync(8000);
        await assertion;
        expect(fetchMock).toHaveBeenCalledTimes(1);
      } finally {
        vi.useRealTimers();
      }
    });
  });
});
