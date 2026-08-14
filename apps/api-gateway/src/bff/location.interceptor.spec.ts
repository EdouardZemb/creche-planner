import { type CallHandler, type ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { firstValueFrom, of } from 'rxjs';
import { describe, expect, it } from 'vitest';
import { LocationInterceptor } from './location.interceptor.js';
import {
  RESSOURCE_CREEE_KEY,
  type IdentifiantCree,
} from './ressource-creee.decorator.js';

/**
 * Ce que la spec unitaire prouve, et que l'E2E ne peut pas : les **branches**.
 * `parcours.e2e.spec.ts` traverse le bundle réel — c'est la seule preuve que
 * l'en-tête part vraiment (`LE-39`) — mais il tourne dans un **sous-processus**,
 * donc rien de ce qui s'y exécute n'est instrumenté. Les chemins de renoncement
 * (identifiant absent, extraction qui lève, en-têtes déjà partis) n'y sont ni
 * atteignables ni mesurables. Les deux specs ne se recouvrent pas : l'une dit
 * « ça part », l'autre « ça ne casse jamais rien ».
 */

/** Réponse Express minimale : mémorise les en-têtes posés. */
function fausseReponse(headersSent = false): {
  headersSent: boolean;
  setHeader: (nom: string, valeur: string) => void;
  entetes: Map<string, string>;
} {
  const entetes = new Map<string, string>();
  return {
    headersSent,
    setHeader: (nom, valeur) => entetes.set(nom.toLowerCase(), valeur),
    entetes,
  };
}

/**
 * Faux `ExecutionContext`. Le handler est un **objet**, pas une classe littérale :
 * un `class {}` inline coûte un avertissement de ratchet (piège déjà consigné) et
 * `Reflect.getMetadata` se moque de la nature de la cible.
 */
function fauxContexte(
  url: string | undefined,
  reponse: unknown,
  identifiant?: IdentifiantCree<unknown>,
  type: 'http' | 'rpc' = 'http',
): { contexte: ExecutionContext; reflector: Reflector } {
  const handler = Object.freeze({});
  if (identifiant !== undefined) {
    Reflect.defineMetadata(RESSOURCE_CREEE_KEY, identifiant, handler);
  }
  const contexte = {
    getType: () => type,
    getHandler: () => handler,
    switchToHttp: () => ({
      getRequest: () => (url === undefined ? {} : { originalUrl: url }),
      getResponse: () => reponse,
    }),
  } as unknown as ExecutionContext;
  return { contexte, reflector: new Reflector() };
}

/** Handler dont la valeur émise est la vue rendue par le contrôleur. */
function handler(vue: unknown): CallHandler {
  return { handle: () => of(vue) };
}

describe('LocationInterceptor', () => {
  it('compose Location depuis l’URL de la collection et l’identifiant rendu', async () => {
    const reponse = fausseReponse();
    const { contexte, reflector } = fauxContexte(
      '/api/v1/foyers/f-1/enfants',
      reponse,
      (vue) => (vue as { id: string }).id,
    );
    const vue = { id: 'e-9' };
    const rendu = await firstValueFrom(
      new LocationInterceptor(reflector).intercept(contexte, handler(vue)),
    );
    expect(reponse.entetes.get('location')).toBe(
      '/api/v1/foyers/f-1/enfants/e-9',
    );
    // La vue traverse l'intercepteur intacte : il ajoute un en-tête, il ne
    // reformule pas le corps.
    expect(rendu).toBe(vue);
  });

  /**
   * Même règle que l'`instance` d'un problème RFC 9457, et le cas n'est pas
   * théorique : un jeton de désabonnement signé voyage en query et désabonne
   * **sans authentification**. Un `Location` est exposé au navigateur, gardé par
   * les journaux d'accès et relayé par les intermédiaires.
   */
  it('ne recopie jamais la chaîne de requête dans l’en-tête', async () => {
    const reponse = fausseReponse();
    const { contexte, reflector } = fauxContexte(
      '/api/v1/foyers?token=secret-signe',
      reponse,
      () => 'f-1',
    );
    await firstValueFrom(
      new LocationInterceptor(reflector).intercept(contexte, handler({})),
    );
    expect(reponse.entetes.get('location')).toBe('/api/v1/foyers/f-1');
  });

  it('encode un identifiant qui contient un caractère de chemin', async () => {
    const reponse = fausseReponse();
    const { contexte, reflector } = fauxContexte(
      '/api/v1/foyers',
      reponse,
      () => 'a/b?c',
    );
    await firstValueFrom(
      new LocationInterceptor(reflector).intercept(contexte, handler({})),
    );
    expect(reponse.entetes.get('location')).toBe('/api/v1/foyers/a%2Fb%3Fc');
  });

  it('retire le slash final de la collection (pas de double slash)', async () => {
    const reponse = fausseReponse();
    const { contexte, reflector } = fauxContexte(
      '/api/v1/foyers/',
      reponse,
      () => 'f-1',
    );
    await firstValueFrom(
      new LocationInterceptor(reflector).intercept(contexte, handler({})),
    );
    expect(reponse.entetes.get('location')).toBe('/api/v1/foyers/f-1');
  });

  it('reste inerte sur une route sans @RessourceCreee', async () => {
    const reponse = fausseReponse();
    const { contexte, reflector } = fauxContexte('/api/v1/foyers', reponse);
    await firstValueFrom(
      new LocationInterceptor(reflector).intercept(contexte, handler({})),
    );
    expect(reponse.entetes.size).toBe(0);
  });

  it('reste inerte hors du transport HTTP', async () => {
    const reponse = fausseReponse();
    const { contexte, reflector } = fauxContexte(
      '/api/v1/foyers',
      reponse,
      () => 'f-1',
      'rpc',
    );
    await firstValueFrom(
      new LocationInterceptor(reflector).intercept(contexte, handler({})),
    );
    expect(reponse.entetes.size).toBe(0);
  });

  it.each([
    ['identifiant absent', undefined],
    ['identifiant vide', ''],
    ['identifiant non textuel', 42 as unknown as string],
  ])('renonce sans lever quand l’amont rend un %s', async (_nom, id) => {
    const reponse = fausseReponse();
    const { contexte, reflector } = fauxContexte(
      '/api/v1/foyers',
      reponse,
      () => id,
    );
    await expect(
      firstValueFrom(
        new LocationInterceptor(reflector).intercept(contexte, handler({})),
      ),
    ).resolves.toEqual({});
    expect(reponse.entetes.has('location')).toBe(false);
  });

  it('renonce sans URL exploitable', async () => {
    const reponse = fausseReponse();
    const { contexte, reflector } = fauxContexte(
      undefined,
      reponse,
      () => 'f-1',
    );
    await firstValueFrom(
      new LocationInterceptor(reflector).intercept(contexte, handler({})),
    );
    expect(reponse.entetes.has('location')).toBe(false);
  });

  /**
   * Le cas qui justifie le `try` : nous sommes **après** l'écriture. Une
   * exception ici transformerait une création réussie en 500, sur lequel le
   * client relancerait une création déjà faite.
   */
  it('rend la réponse quand l’extraction lève (la création a déjà eu lieu)', async () => {
    const reponse = fausseReponse();
    const { contexte, reflector } = fauxContexte(
      '/api/v1/foyers',
      reponse,
      (vue) => (vue as { foyer: { id: string } }).foyer.id,
    );
    // Forme d'amont inattendue : `vue.foyer` est absent, le déréférencement lève.
    const vue = { dossier: {} };
    await expect(
      firstValueFrom(
        new LocationInterceptor(reflector).intercept(contexte, handler(vue)),
      ),
    ).resolves.toBe(vue);
    expect(reponse.entetes.has('location')).toBe(false);
  });

  it('ne pose rien si les en-têtes sont déjà partis', async () => {
    const reponse = fausseReponse(true);
    const { contexte, reflector } = fauxContexte(
      '/api/v1/foyers',
      reponse,
      () => 'f-1',
    );
    await firstValueFrom(
      new LocationInterceptor(reflector).intercept(contexte, handler({})),
    );
    expect(reponse.entetes.has('location')).toBe(false);
  });

  it('journalise le renoncement plutôt que de le taire', async () => {
    const reponse = fausseReponse();
    const { contexte, reflector } = fauxContexte(
      '/api/v1/foyers',
      reponse,
      () => {
        throw new Error('forme amont inattendue');
      },
    );
    const interceptor = new LocationInterceptor(reflector);
    const journal: string[] = [];
    // `logger` est un champ privé d'instance : on le remplace sur l'objet plutôt
    // que d'espionner la classe `Logger` de Nest, dont la sortie est globale et
    // déborderait sur les autres specs du fichier.
    Object.defineProperty(interceptor, 'logger', {
      value: { warn: (message: string) => journal.push(message) },
    });
    await firstValueFrom(interceptor.intercept(contexte, handler({})));
    expect(journal).toHaveLength(1);
    expect(journal[0]).toContain('forme amont inattendue');
  });
});
