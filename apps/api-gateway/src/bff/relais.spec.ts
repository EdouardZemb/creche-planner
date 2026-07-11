import { describe, expect, it } from 'vitest';
import { HttpException } from '@nestjs/common';
import { relayer } from './relais.js';
import { ErreurAmont } from '../clients/appel-resilient.js';

/**
 * `relayer` traduit l'échec d'un appel aval en `HttpException`. Lot 1 : une
 * `ErreurAmont` **4xx** (corps capturé par `FoyerClient`) est réémise **corps
 * compris** (le front lit `code`) ; les 5xx / pannes réseau / erreurs d'autres
 * clients gardent la sémantique historique (statut dérivé, corps générique).
 */
describe('relayer', () => {
  it('réémet le corps amont d’une ErreurAmont 4xx tel quel (code préservé)', async () => {
    const corps = {
      statusCode: 409,
      code: 'DERNIER_PARENT_ACTIF',
      message: 'impossible de retirer le dernier parent actif du foyer',
    };

    const err = await relayer(() =>
      Promise.reject(new ErreurAmont(409, corps)),
    ).catch((e: unknown) => e);

    expect(err).toBeInstanceOf(HttpException);
    expect((err as HttpException).getStatus()).toBe(409);
    expect((err as HttpException).getResponse()).toEqual(corps);
  });

  it('réémet un 404 amont structuré tel quel', async () => {
    const corps = { statusCode: 404, message: 'foyer introuvable' };

    const err = await relayer(() =>
      Promise.reject(new ErreurAmont(404, corps)),
    ).catch((e: unknown) => e);

    expect((err as HttpException).getStatus()).toBe(404);
    expect((err as HttpException).getResponse()).toEqual(corps);
  });

  it('ne relaie PAS le corps d’une ErreurAmont 5xx (sémantique inchangée → corps générique)', async () => {
    const err = await relayer(() =>
      Promise.reject(new ErreurAmont(503, { code: 'PEU_IMPORTE' })),
    ).catch((e: unknown) => e);

    expect((err as HttpException).getStatus()).toBe(503);
    expect((err as HttpException).getResponse()).toMatchObject({
      message: 'erreur du service amont',
    });
  });

  it('conserve le repli Error(HTTP <code>) des autres clients (statut réémis)', async () => {
    const err = await relayer(() =>
      Promise.reject(new Error('HTTP 404')),
    ).catch((e: unknown) => e);

    expect((err as HttpException).getStatus()).toBe(404);
  });

  it('mappe une panne réseau (message quelconque) en 502 Bad Gateway', async () => {
    const err = await relayer(() => Promise.reject(new Error('boom'))).catch(
      (e: unknown) => e,
    );

    expect((err as HttpException).getStatus()).toBe(502);
  });
});
