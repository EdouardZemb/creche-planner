import { describe, it, expect, vi } from 'vitest';
import { seReconnecter } from './reconnexion';

// Les dépendances (conteneur SW, rechargement) sont injectées : pas besoin de
// trafiquer navigator/location (non configurables sous jsdom).

function fauxSW(enregistrements: { unregister: () => Promise<boolean> }[]) {
  return {
    getRegistrations: vi.fn().mockResolvedValue(enregistrements),
  };
}

describe('seReconnecter — sortie de session expirée', () => {
  it('désenregistre tous les SW PUIS recharge (la navigation repart sur le réseau)', async () => {
    const unregister1 = vi.fn().mockResolvedValue(true);
    const unregister2 = vi.fn().mockResolvedValue(true);
    const recharger = vi.fn();

    await seReconnecter(
      fauxSW([{ unregister: unregister1 }, { unregister: unregister2 }]),
      recharger,
    );

    expect(unregister1).toHaveBeenCalledOnce();
    expect(unregister2).toHaveBeenCalledOnce();
    expect(recharger).toHaveBeenCalledOnce();
    // L'ordre compte : recharger avant le désenregistrement servirait encore le cache.
    expect(recharger.mock.invocationCallOrder[0]).toBeGreaterThan(
      unregister1.mock.invocationCallOrder[0] ?? 0,
    );
  });

  it('sans service worker (dev/LAN, contexte non sécurisé) : recharge simplement', async () => {
    const recharger = vi.fn();

    await seReconnecter(undefined, recharger);

    expect(recharger).toHaveBeenCalledOnce();
  });

  it('désenregistrement en échec : recharge quand même (jamais une impasse)', async () => {
    const recharger = vi.fn();
    const sw = {
      getRegistrations: vi.fn().mockRejectedValue(new Error('SW indisponible')),
    };

    await seReconnecter(sw, recharger);

    expect(recharger).toHaveBeenCalledOnce();
  });
});
