import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  detaillerErreur,
  installerRemonteeErreurs,
  reinitialiserRemonteeErreurs,
  signalerErreurClient,
} from './signalerErreur';

/** Corps JSON du n-ième appel `fetch`. */
function corpsEnvoye(appel: number): Record<string, unknown> {
  const mock = vi.mocked(globalThis.fetch);
  const init = mock.mock.calls[appel]?.[1];
  return JSON.parse(String(init?.body)) as Record<string, unknown>;
}

describe('signalerErreurClient', () => {
  beforeEach(() => {
    reinitialiserRemonteeErreurs();
    globalThis.fetch = vi.fn().mockResolvedValue(
      new Response(null, {
        status: 204,
      }),
    );
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('poste le signalement en MÊME-ORIGINE, avec keepalive', () => {
    signalerErreurClient({
      origine: 'route',
      message: 'boum',
      route: '/foyers/abc/planning',
    });

    expect(globalThis.fetch).toHaveBeenCalledTimes(1);
    const [url, init] = vi.mocked(globalThis.fetch).mock.calls[0] ?? [];
    // Chemin relatif : aucun hôte tiers, la CSP même-origine (A6) l'interdirait.
    expect(url).toBe('/api/v1/erreurs-client');
    expect(init?.method).toBe('POST');
    expect(init?.keepalive).toBe(true);
    expect(corpsEnvoye(0)).toEqual({
      origine: 'route',
      message: 'boum',
      route: '/foyers/abc/planning',
    });
  });

  it('n’envoie pas deux fois le même plantage (rendu en boucle)', () => {
    signalerErreurClient({ origine: 'route', message: 'boum', route: '/' });
    signalerErreurClient({ origine: 'route', message: 'boum', route: '/' });

    expect(globalThis.fetch).toHaveBeenCalledTimes(1);
  });

  it('plafonne les envois par chargement de page', () => {
    for (let i = 0; i < 12; i += 1) {
      signalerErreurClient({
        origine: 'globale',
        message: `erreur ${String(i)}`,
        route: '/',
      });
    }

    // Sans plafond, un plantage local inonderait la gateway — dont le
    // `RateLimitGuard` répondrait alors 429 à TOUTES les requêtes du client.
    expect(globalThis.fetch).toHaveBeenCalledTimes(5);
  });

  it('tronque message, pile et composant aux bornes du contrat', () => {
    signalerErreurClient({
      origine: 'application',
      message: 'm'.repeat(900),
      route: '/',
      pile: 'p'.repeat(5000),
      composant: 'c'.repeat(2000),
    });

    const corps = corpsEnvoye(0);
    expect(String(corps['message'])).toHaveLength(500);
    expect(String(corps['pile'])).toHaveLength(4000);
    expect(String(corps['composant'])).toHaveLength(1000);
  });

  it('n’envoie ni `pile` ni `composant` quand ils sont absents', () => {
    signalerErreurClient({ origine: 'chunk', message: 'x', route: '/' });

    expect(corpsEnvoye(0)).not.toHaveProperty('pile');
    expect(corpsEnvoye(0)).not.toHaveProperty('composant');
  });

  it('avale un échec réseau : la remontée ne doit jamais casser plus', async () => {
    globalThis.fetch = vi.fn().mockRejectedValue(new TypeError('offline'));

    expect(() => {
      signalerErreurClient({ origine: 'route', message: 'boum', route: '/' });
    }).not.toThrow();
    // La promesse rejetée est bien traitée (sinon `unhandledrejection`).
    await Promise.resolve();
  });

  it('avale un `fetch` qui lève de façon synchrone', () => {
    globalThis.fetch = vi.fn(() => {
      throw new Error('fetch indisponible');
    });

    expect(() => {
      signalerErreurClient({ origine: 'route', message: 'boum', route: '/' });
    }).not.toThrow();
  });
});

describe('detaillerErreur', () => {
  it('rend message et pile d’une Error', () => {
    const erreur = new Error('cassé');
    expect(detaillerErreur(erreur)).toEqual({
      message: 'cassé',
      pile: erreur.stack,
    });
  });

  it('retombe sur le nom quand le message est vide', () => {
    expect(detaillerErreur(new TypeError('')).message).toBe('TypeError');
  });

  it('accepte une valeur non-Error (on peut `throw` n’importe quoi)', () => {
    expect(detaillerErreur('juste une chaîne').message).toBe(
      'juste une chaîne',
    );
    expect(detaillerErreur(42).message).toBe('42');
  });
});

describe('installerRemonteeErreurs', () => {
  let desinstaller: () => void;

  beforeEach(() => {
    reinitialiserRemonteeErreurs();
    globalThis.fetch = vi.fn().mockResolvedValue(
      new Response(null, {
        status: 204,
      }),
    );
    desinstaller = installerRemonteeErreurs();
  });

  afterEach(() => {
    desinstaller();
    vi.restoreAllMocks();
  });

  it('remonte une exception hors rendu (window.onerror)', () => {
    window.dispatchEvent(
      new ErrorEvent('error', {
        message: 'hors rendu',
        error: new Error('hors rendu'),
      }),
    );

    expect(corpsEnvoye(0)['origine']).toBe('globale');
    expect(corpsEnvoye(0)['message']).toBe('hors rendu');
  });

  it('remonte une promesse rejetée sans `catch`', () => {
    // jsdom n'émet pas `unhandledrejection` : on construit l'événement.
    const evenement = new Event('unhandledrejection') as Event & {
      reason?: unknown;
    };
    evenement.reason = new Error('promesse morte');
    window.dispatchEvent(evenement);

    expect(corpsEnvoye(0)['origine']).toBe('promesse');
    expect(corpsEnvoye(0)['message']).toBe('promesse morte');
  });

  it('se retire proprement (aucune remontée après désinstallation)', () => {
    desinstaller();
    window.dispatchEvent(new ErrorEvent('error', { message: 'après coup' }));

    expect(globalThis.fetch).not.toHaveBeenCalled();
  });
});
