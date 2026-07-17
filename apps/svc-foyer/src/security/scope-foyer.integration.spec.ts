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
import { FoyerController } from '../foyer/foyer.controller.js';

/**
 * Intégration du **scoping par ressource en enforce** de svc-foyer (fondations lot 4).
 * On câble la vraie chaîne de guards (`AssertionIdentiteGuard` puis `ScopeFoyerGuard`)
 * avec un `Reflector` **réel** lisant les métadonnées `@ScopeFoyerInterServices` posées
 * sur les **vraies** méthodes du contrôleur — la preuve que chaque route porte sa règle
 * et que l'enforce produit les bons verdicts (200 / 403 / 401), sans base ni HTTP.
 *
 * svc-foyer scope en **direct** : foyer `:id` (défaut de contrôleur) et e-mails
 * `createurEmail`/`parentEmail`. Aucune résolution en base → pas de cas « 404 » ici
 * (couvert par svc-planification / svc-notifications, routes `resoudre`).
 */

const SECRET = 'integ-foyer-secret';
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
    getClass: () => FoyerController,
  } as unknown as ExecutionContext;
}

/** Exécute la chaîne réelle identité → scope. Propage 401 (identité) / 403 (scope). */
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

function requete(p: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    headers: {},
    method: 'GET',
    originalUrl: '/api/foyers',
    params: {},
    query: {},
    body: {},
    ...p,
  };
}

const P = FoyerController.prototype;

describe('svc-foyer · scoping enforce', () => {
  describe('GET /foyers/:id (foyer direct, défaut de contrôleur)', () => {
    it('foyer du parent → passe (200)', async () => {
      const req = requete({
        params: { id: FOYER },
        headers: entete({ email: 'p@x.fr', foyers: [FOYER] }),
      });
      await expect(chaine(ctx(P.obtenir, req))).resolves.toBe(true);
    });

    it('foyer étranger → 403', async () => {
      const req = requete({
        params: { id: FOYER },
        headers: entete({ email: 'p@x.fr', foyers: [AUTRE_FOYER] }),
      });
      await expect(chaine(ctx(P.obtenir, req))).rejects.toBeInstanceOf(
        ForbiddenException,
      );
    });

    it('sans en-tête → 401 (guard identité amont)', async () => {
      const req = requete({ params: { id: FOYER } });
      await expect(chaine(ctx(P.obtenir, req))).rejects.toBeInstanceOf(
        UnauthorizedException,
      );
    });

    it('assertion machine → passe (bypass)', async () => {
      const req = requete({
        params: { id: FOYER },
        headers: entete({ machine: 'api-gateway' }),
      });
      await expect(chaine(ctx(P.obtenir, req))).resolves.toBe(true);
    });

    it('assertion expirée → 401 (guard identité amont)', async () => {
      const expiree = new Date(Date.now() - 200_000); // exp = iat+60s, hors tolérance ±30s
      const req = requete({
        params: { id: FOYER },
        headers: entete({ email: 'p@x.fr', foyers: [FOYER] }, expiree),
      });
      await expect(chaine(ctx(P.obtenir, req))).rejects.toBeInstanceOf(
        UnauthorizedException,
      );
    });

    it('admin (assertion admin) → passe (bypass)', async () => {
      const req = requete({
        params: { id: FOYER },
        headers: entete({
          email: 'admin@x.fr',
          foyers: [AUTRE_FOYER],
          admin: true,
        }),
      });
      await expect(chaine(ctx(P.obtenir, req))).resolves.toBe(true);
    });
  });

  describe('POST /foyers (créateur = identité, e-mail direct)', () => {
    it('créateur = identité (insensible à la casse) → passe', async () => {
      const req = requete({
        method: 'POST',
        body: { createurEmail: 'Alex@Exemple.FR' },
        headers: entete({ email: 'alex@exemple.fr' }),
      });
      await expect(chaine(ctx(P.creer, req))).resolves.toBe(true);
    });

    it('créateur ≠ identité → 403', async () => {
      const req = requete({
        method: 'POST',
        body: { createurEmail: 'autre@exemple.fr' },
        headers: entete({ email: 'alex@exemple.fr' }),
      });
      await expect(chaine(ctx(P.creer, req))).rejects.toBeInstanceOf(
        ForbiddenException,
      );
    });
  });

  describe('GET /foyers?parentEmail= (résolution par e-mail direct)', () => {
    it('parentEmail = identité → passe', async () => {
      const req = requete({
        query: { parentEmail: 'alex@exemple.fr' },
        headers: entete({ email: 'alex@exemple.fr' }),
      });
      await expect(chaine(ctx(P.lister, req))).resolves.toBe(true);
    });

    it('parentEmail ≠ identité → 403', async () => {
      const req = requete({
        query: { parentEmail: 'victime@exemple.fr' },
        headers: entete({ email: 'alex@exemple.fr' }),
      });
      await expect(chaine(ctx(P.lister, req))).rejects.toBeInstanceOf(
        ForbiddenException,
      );
    });
  });
});
