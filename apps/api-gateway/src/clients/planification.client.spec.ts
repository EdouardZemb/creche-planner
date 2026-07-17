import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ENTETE_ASSERTION } from '@creche-planner/nest-commons/security';
import { PlanificationClient } from './planification.client.js';

/**
 * Client résilient gateway→svc-planification (fondations lot 6) : les méthodes
 * principales — `contrat` (lecture) et `lirePlanning` (planning) — succès,
 * erreur HTTP, timeout via `executerResilient` (fake timers, comme
 * `libs/resilience/src/lib/resilience.spec.ts`). On vérifie aussi (fondations
 * lot 3) que l'assertion d'identité (`entetesAval()`) est bien propagée sur les
 * appels sortants. `fetch` est mocké via `vi.stubGlobal`.
 */

const CONTRAT_OK = {
  id: 'c-1',
  foyerId: 'f-1',
  enfant: 'Mia',
  enfantId: 'e-1',
  mode: 'CRECHE_PSU',
  valideDu: '2026-01-01',
  valideAu: null,
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

describe('PlanificationClient (gateway→svc-planification)', () => {
  let envInitial: NodeJS.ProcessEnv;

  beforeEach(() => {
    envInitial = { ...process.env };
  });

  afterEach(() => {
    process.env = envInitial;
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  describe('contrat', () => {
    it('succès → renvoie le contrat parsé', async () => {
      vi.stubGlobal(
        'fetch',
        vi.fn(async () => ({
          ok: true,
          status: 200,
          json: async () => CONTRAT_OK,
        })),
      );
      const contrat = await new PlanificationClient().contrat('c-1');
      expect(contrat.id).toBe('c-1');
      expect(contrat.foyerId).toBe('f-1');
    });

    it('erreur HTTP → propage Error(HTTP <code>)', async () => {
      vi.stubGlobal(
        'fetch',
        vi.fn(async () => ({ ok: false, status: 404, json: async () => ({}) })),
      );
      await expect(new PlanificationClient().contrat('c-1')).rejects.toThrow(
        'HTTP 404',
      );
    });

    it('timeout → rejette après épuisement des tentatives (executerResilient)', async () => {
      vi.useFakeTimers();
      try {
        const fetchMock = fetchQuiTimeoutToujours();
        vi.stubGlobal('fetch', fetchMock);
        const promesse = new PlanificationClient().contrat('c-1');
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
        json: async () => CONTRAT_OK,
      }));
      vi.stubGlobal('fetch', fetchMock);
      await new PlanificationClient().contrat('c-1');
      expect(dernierEntetes(fetchMock)[ENTETE_ASSERTION]).toBeDefined();
    });
  });

  describe('lirePlanning', () => {
    it('succès → renvoie la saisie du mois', async () => {
      vi.stubGlobal(
        'fetch',
        vi.fn(async () => ({
          ok: true,
          status: 200,
          json: async () => ({ saisie: { lundi: 8 } }),
        })),
      );
      const reponse = await new PlanificationClient().lirePlanning(
        'c-1',
        '2026-01',
        false,
      );
      expect(reponse.saisie).toEqual({ lundi: 8 });
    });

    it('erreur HTTP → propage Error(HTTP <code>)', async () => {
      vi.stubGlobal(
        'fetch',
        vi.fn(async () => ({ ok: false, status: 503, json: async () => ({}) })),
      );
      await expect(
        new PlanificationClient().lirePlanning('c-1', '2026-01', false),
      ).rejects.toThrow('HTTP 503');
    });
  });
});
