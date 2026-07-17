import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ENTETE_ASSERTION } from '@creche-planner/nest-commons';
import {
  DesabonnementClient,
  type DemandeJeton,
} from './desabonnement.client.js';

/**
 * Émission des jetons de désabonnement notif→foyer : chemin nominal (jeton renvoyé),
 * erreur réseau → `undefined` (dégradation propre, le récap part sans en-tête
 * `List-Unsubscribe`), et injection de l'assertion machine inter-services (fondations
 * lot 3) sur `POST /api/desabonnement/jetons` — route interne NON exemptée.
 */
const DEMANDE: DemandeJeton = {
  foyerId: 'f-1',
  parentId: 'p-1',
  typeNotification: 'VALIDATION_HEBDO',
  canal: 'EMAIL',
};

function dernierEntetes(
  fetchMock: ReturnType<typeof vi.fn>,
): Record<string, string> {
  const init = fetchMock.mock.calls[0]?.[1] as {
    headers?: Record<string, string>;
  };
  return init?.headers ?? {};
}

describe('DesabonnementClient (émission jeton notif→foyer)', () => {
  let envInitial: NodeJS.ProcessEnv;

  beforeEach(() => {
    envInitial = { ...process.env };
    vi.restoreAllMocks();
  });

  afterEach(() => {
    process.env = envInitial;
  });

  it('chemin nominal → renvoie le token signé', async () => {
    delete process.env['ASSERTION_IDENTITE_SECRET'];
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({
        ok: true,
        status: 201,
        json: async () => ({ token: 'jeton-abc', expireLe: '2100-01-01' }),
      })),
    );
    expect(await new DesabonnementClient().emettreJeton(DEMANDE)).toBe(
      'jeton-abc',
    );
  });

  it('erreur réseau → undefined (le récap part sans List-Unsubscribe)', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new Error('ECONNREFUSED');
      }),
    );
    expect(
      await new DesabonnementClient().emettreJeton(DEMANDE),
    ).toBeUndefined();
  });

  it('injecte l’assertion machine + Content-Type quand le secret est configuré', async () => {
    process.env['ASSERTION_IDENTITE_SECRET'] = 'secret-test';
    const fetchMock = vi.fn(async () => ({
      ok: true,
      status: 201,
      json: async () => ({ token: 't', expireLe: '2100-01-01' }),
    }));
    vi.stubGlobal('fetch', fetchMock);
    await new DesabonnementClient().emettreJeton(DEMANDE);
    const entetes = dernierEntetes(fetchMock);
    expect(entetes[ENTETE_ASSERTION]).toBeDefined();
    expect(entetes['Content-Type']).toBe('application/json');
  });
});
