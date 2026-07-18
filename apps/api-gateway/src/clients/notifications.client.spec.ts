import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ENTETE_ASSERTION } from '@creche-planner/nest-commons/security';
import { NotificationsClient } from './notifications.client.js';

/**
 * Client résilient gateway→svc-notifications (fondations lot 6) : les méthodes
 * principales — `listerAValider` (lecture) et `validerSemaine` (validation) —
 * succès, erreur HTTP, timeout via `executerResilient` (fake timers, comme
 * `libs/resilience/src/lib/resilience.spec.ts`). On vérifie aussi (fondations
 * lot 3) que l'assertion d'identité (`entetesAval()`) est propagée sur les
 * appels sortants. `fetch` est mocké via `vi.stubGlobal`.
 */

const A_VALIDER_OK = [
  {
    contratId: 'c-1',
    foyerId: 'f-1',
    semaineIso: '2026-W03',
    statut: 'A_VALIDER',
    notifieeLe: '2026-01-13T08:00:00.000Z',
  },
];

const VALIDATION_OK = {
  contratId: 'c-1',
  semaineIso: '2026-W03',
  statut: 'VALIDEE',
  deltaModifs: null,
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

describe('NotificationsClient (gateway→svc-notifications)', () => {
  let envInitial: NodeJS.ProcessEnv;

  beforeEach(() => {
    envInitial = { ...process.env };
  });

  afterEach(() => {
    process.env = envInitial;
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  describe('listerAValider', () => {
    it('succès → renvoie les semaines à valider parsées', async () => {
      vi.stubGlobal(
        'fetch',
        vi.fn(async () => ({
          ok: true,
          status: 200,
          json: async () => A_VALIDER_OK,
        })),
      );
      const liste = await new NotificationsClient().listerAValider('f-1');
      expect(liste).toHaveLength(1);
      expect(liste[0]?.statut).toBe('A_VALIDER');
    });

    it('erreur HTTP → propage Error(HTTP <code>)', async () => {
      vi.stubGlobal(
        'fetch',
        vi.fn(async () => ({ ok: false, status: 503, json: async () => ({}) })),
      );
      await expect(
        new NotificationsClient().listerAValider('f-1'),
      ).rejects.toThrow('HTTP 503');
    });

    it('timeout → rejette après épuisement des tentatives (executerResilient)', async () => {
      vi.useFakeTimers();
      try {
        const fetchMock = fetchQuiTimeoutToujours();
        vi.stubGlobal('fetch', fetchMock);
        const promesse = new NotificationsClient().listerAValider('f-1');
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
        json: async () => A_VALIDER_OK,
      }));
      vi.stubGlobal('fetch', fetchMock);
      await new NotificationsClient().listerAValider('f-1');
      expect(dernierEntetes(fetchMock)[ENTETE_ASSERTION]).toBeDefined();
    });
  });

  describe('validerSemaine', () => {
    it('succès → renvoie le résultat de validation parsé', async () => {
      vi.stubGlobal(
        'fetch',
        vi.fn(async () => ({
          ok: true,
          status: 200,
          json: async () => VALIDATION_OK,
        })),
      );
      const resultat = await new NotificationsClient().validerSemaine(
        'c-1',
        '2026-W03',
      );
      expect(resultat.statut).toBe('VALIDEE');
    });

    it('erreur HTTP → propage Error(HTTP <code>)', async () => {
      vi.stubGlobal(
        'fetch',
        vi.fn(async () => ({ ok: false, status: 409, json: async () => ({}) })),
      );
      await expect(
        new NotificationsClient().validerSemaine('c-1', '2026-W03'),
      ).rejects.toThrow('HTTP 409');
    });
  });

  describe('lireSuiviEnvois (B1)', () => {
    const SUIVI_OK = {
      foyerId: 'f-1',
      semaineIso: '2026-W03',
      rappel: {
        statut: 'ENVOYE',
        envoyeLe: '2026-01-13T08:00:00.000Z',
        erreur: null,
        parents: [
          {
            email: 'parent@ex.org',
            statut: 'ENVOYE',
            envoyeLe: '2026-01-13T08:00:00.000Z',
            essais: 0,
          },
        ],
      },
      etablissements: [
        {
          etablissementId: 'e-1',
          statut: 'DRY_RUN',
          envoyeLe: '2026-01-13T08:05:00.000Z',
          erreur: null,
          destinataire: 'creche@ex.org',
        },
      ],
    };

    it('succès → renvoie le suivi parsé (rappel + établissements)', async () => {
      vi.stubGlobal(
        'fetch',
        vi.fn(async () => ({
          ok: true,
          status: 200,
          json: async () => SUIVI_OK,
        })),
      );
      const suivi = await new NotificationsClient().lireSuiviEnvois(
        'f-1',
        '2026-W03',
      );
      expect(suivi.rappel?.statut).toBe('ENVOYE');
      expect(suivi.rappel?.parents[0]?.essais).toBe(0);
      expect(suivi.etablissements[0]?.statut).toBe('DRY_RUN');
    });

    it('cas vide → rappel null, établissements vides', async () => {
      vi.stubGlobal(
        'fetch',
        vi.fn(async () => ({
          ok: true,
          status: 200,
          json: async () => ({
            foyerId: 'f-1',
            semaineIso: '2026-W03',
            rappel: null,
            etablissements: [],
          }),
        })),
      );
      const suivi = await new NotificationsClient().lireSuiviEnvois(
        'f-1',
        '2026-W03',
      );
      expect(suivi.rappel).toBeNull();
      expect(suivi.etablissements).toEqual([]);
    });

    it('erreur HTTP → propage Error(HTTP <code>)', async () => {
      vi.stubGlobal(
        'fetch',
        vi.fn(async () => ({ ok: false, status: 503, json: async () => ({}) })),
      );
      await expect(
        new NotificationsClient().lireSuiviEnvois('f-1', '2026-W03'),
      ).rejects.toThrow('HTTP 503');
    });
  });
});
