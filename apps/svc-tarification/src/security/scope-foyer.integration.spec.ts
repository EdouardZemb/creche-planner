import 'reflect-metadata';
/* eslint-disable @typescript-eslint/unbound-method -- les méthodes de contrôleur sont
   passées PAR RÉFÉRENCE (jamais appelées) comme « handler » du faux ExecutionContext,
   pour que le Reflector réel lise leurs métadonnées @ScopeFoyerInterServices ; `this`
   n'est jamais lié. */
import {
  type ExecutionContext,
  ForbiddenException,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { describe, expect, it } from 'vitest';
import {
  AssertionIdentiteGuard,
  ENTETE_ASSERTION,
  ScopeFoyerGuard,
  signerAssertion,
  type ConfigAssertion,
  type EntreeAssertion,
} from '@creche-planner/nest-commons';
import { CoutController } from '../tarification/cout.controller.js';

/**
 * Intégration du **scoping enforce** de svc-tarification (fondations lot 4). Les deux
 * routes coûts portent `?foyer=` (scoping direct, aucun résolveur en base). On câble la
 * vraie chaîne identité → scope avec un `Reflector` réel lisant les métadonnées
 * `@ScopeFoyerInterServices` des vraies méthodes du contrôleur.
 */

const SECRET = 'integ-tarif-secret';
const ENFORCE: ConfigAssertion = { secret: SECRET, enforce: true };
const options = { chargerConfig: () => ({ assertion: ENFORCE }) };

const FOYER = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const AUTRE_FOYER = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';

function ctx(
  methode: (...args: never[]) => unknown,
  req: Record<string, unknown>,
): ExecutionContext {
  return {
    switchToHttp: () => ({ getRequest: () => req }),
    getHandler: () => methode,
    getClass: () => CoutController,
  } as unknown as ExecutionContext;
}

async function chaine(c: ExecutionContext): Promise<boolean> {
  const reflector = new Reflector();
  const identite = new AssertionIdentiteGuard(reflector, options);
  const scope = new ScopeFoyerGuard(reflector, options);
  if (!identite.canActivate(c)) {
    return false;
  }
  return scope.canActivate(c);
}

function entete(
  entree: EntreeAssertion,
  maintenant?: Date,
): Record<string, string> {
  return { [ENTETE_ASSERTION]: signerAssertion(entree, SECRET, maintenant) };
}

function requete(
  query: Record<string, unknown>,
  headers = {},
): Record<string, unknown> {
  return {
    headers,
    method: 'GET',
    originalUrl: '/api/couts',
    params: {},
    query,
    body: {},
  };
}

const P = CoutController.prototype;

describe('svc-tarification · scoping enforce (GET /couts, /couts/annuel — ?foyer=)', () => {
  it('foyer du parent → passe (200)', async () => {
    const req = requete(
      { foyer: FOYER },
      entete({ email: 'p@x.fr', foyers: [FOYER] }),
    );
    await expect(chaine(ctx(P.coutMois, req))).resolves.toBe(true);
    await expect(chaine(ctx(P.coutAnnuel, req))).resolves.toBe(true);
  });

  it('foyer étranger → 403', async () => {
    const req = requete(
      { foyer: FOYER },
      entete({ email: 'p@x.fr', foyers: [AUTRE_FOYER] }),
    );
    await expect(chaine(ctx(P.coutMois, req))).rejects.toBeInstanceOf(
      ForbiddenException,
    );
  });

  it('sans en-tête → 401 (guard identité amont)', async () => {
    const req = requete({ foyer: FOYER });
    await expect(chaine(ctx(P.coutMois, req))).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
  });

  it('assertion machine → passe (bypass)', async () => {
    const req = requete({ foyer: FOYER }, entete({ machine: 'api-gateway' }));
    await expect(chaine(ctx(P.coutAnnuel, req))).resolves.toBe(true);
  });

  it('assertion expirée → 401 (guard identité amont)', async () => {
    const expiree = new Date(Date.now() - 200_000);
    const req = requete(
      { foyer: FOYER },
      entete({ email: 'p@x.fr', foyers: [FOYER] }, expiree),
    );
    await expect(chaine(ctx(P.coutMois, req))).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
  });
});
