import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('../config.js', () => ({
  loadConfig: () => ({ foyerUrl: 'http://svc-foyer:3002' }),
}));

import { FoyerClient } from './foyer.client.js';
import { ErreurAmont } from './appel-resilient.js';

/**
 * `FoyerClient` **opte pour la capture du corps d'erreur amont** (`svc-foyer`
 * porte des 409 structurés). Lot 1 : sur une réponse non-2xx **au corps JSON
 * parseable**, il lève `ErreurAmont(status, corps)` — que `relayer` réémet tel
 * quel ; sinon (corps non-JSON) il retombe sur `Error('HTTP <code>')`.
 *
 * `fetch` global est mocké ; `OPTIONS.retries = 1` ⇒ 2 appels sur échec.
 */
function reponseJson(status: number, corps: unknown): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: () => Promise.resolve(corps),
  } as unknown as Response;
}

function reponseNonJson(status: number): Response {
  return {
    ok: false,
    status,
    json: () => Promise.reject(new SyntaxError('corps non JSON')),
  } as unknown as Response;
}

describe('FoyerClient · capture du corps d’erreur amont', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('lève ErreurAmont(409, corps) sur un 409 structuré de svc-foyer', async () => {
    const corps = {
      statusCode: 409,
      code: 'DERNIER_PARENT_ACTIF',
      message: 'impossible de retirer le dernier parent actif du foyer',
    };
    vi.stubGlobal(
      'fetch',
      vi.fn(() => Promise.resolve(reponseJson(409, corps))),
    );

    const err = await new FoyerClient()
      .retirerParent('foyer-1', 'parent-1')
      .catch((e: unknown) => e);

    expect(err).toBeInstanceOf(ErreurAmont);
    expect((err as ErreurAmont).status).toBe(409);
    expect((err as ErreurAmont).corps).toEqual(corps);
  });

  it('retombe sur Error(HTTP <code>) si le corps n’est pas du JSON', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() => Promise.resolve(reponseNonJson(409))),
    );

    const err = await new FoyerClient()
      .retirerParent('foyer-1', 'parent-1')
      .catch((e: unknown) => e);

    expect(err).toBeInstanceOf(Error);
    expect(err).not.toBeInstanceOf(ErreurAmont);
    expect((err as Error).message).toBe('HTTP 409');
  });
});
