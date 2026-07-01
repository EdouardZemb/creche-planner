import { BadRequestException, HttpException } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';
import { type FoyerClient } from '../clients/foyer.client.js';
import { DesabonnementController } from './desabonnement.controller.js';

function fakeFoyers(desabonner: (token: string) => Promise<void>): {
  client: FoyerClient;
  desabonner: ReturnType<typeof vi.fn>;
} {
  const spy = vi.fn(desabonner);
  return {
    client: { desabonner: spy } as unknown as FoyerClient,
    desabonner: spy,
  };
}

/** Statut HTTP porté par le rejet (via `HttpException.getStatus()`). */
async function statutRejete(operation: Promise<unknown>): Promise<number> {
  try {
    await operation;
  } catch (erreur) {
    if (erreur instanceof HttpException) {
      return erreur.getStatus();
    }
    throw erreur;
  }
  throw new Error('rejet attendu');
}

describe('DesabonnementController (POST /api/v1/desabonnement, public)', () => {
  it('jeton absent : 400 générique, svc-foyer non sollicité (pas d’énumération)', async () => {
    const { client, desabonner } = fakeFoyers(async () => undefined);
    const controller = new DesabonnementController(client);

    await expect(controller.desabonner(undefined)).rejects.toBeInstanceOf(
      BadRequestException,
    );
    await expect(controller.desabonner('   ')).rejects.toBeInstanceOf(
      BadRequestException,
    );
    expect(desabonner).not.toHaveBeenCalled();
  });

  it('jeton valide : relaie le jeton à svc-foyer et résout (204)', async () => {
    const { client, desabonner } = fakeFoyers(async () => undefined);
    const controller = new DesabonnementController(client);

    await expect(controller.desabonner('jeton-xyz')).resolves.toBeUndefined();
    expect(desabonner).toHaveBeenCalledWith('jeton-xyz');
  });

  it('dernier canal d’un service : réémet le 409 amont', async () => {
    const { client } = fakeFoyers(async () => {
      throw new Error('HTTP 409');
    });
    const controller = new DesabonnementController(client);

    await expect(
      statutRejete(controller.desabonner('jeton-xyz')),
    ).resolves.toBe(409);
  });

  it('jeton invalide/expiré/déjà utilisé : réémet le 400 amont', async () => {
    const { client } = fakeFoyers(async () => {
      throw new Error('HTTP 400');
    });
    const controller = new DesabonnementController(client);

    await expect(
      statutRejete(controller.desabonner('jeton-use')),
    ).resolves.toBe(400);
  });

  it('panne amont (pas de code HTTP) : 502 Bad Gateway', async () => {
    const { client } = fakeFoyers(async () => {
      throw new Error('ECONNREFUSED');
    });
    const controller = new DesabonnementController(client);

    await expect(
      statutRejete(controller.desabonner('jeton-xyz')),
    ).resolves.toBe(502);
  });
});
