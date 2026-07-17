import {
  type ExecutionContext,
  ForbiddenException,
  Logger,
} from '@nestjs/common';
import { type Reflector } from '@nestjs/core';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { type ChargeAssertion } from './assertion-identite.js';
import { type ConfigAssertion } from './assertion-identite.options.js';
import { ScopeFoyerGuard, type RequeteScopable } from './scope-foyer.guard.js';
import { type SourceScopeFoyer } from './scope-foyer.decorator.js';
import {
  type PorteeRessource,
  type ResolveurFoyerRessource,
} from './scope-foyer.resolveur.js';

const FOYER_A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const FOYER_B = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const CONTRAT = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';

/** Faux Reflector : la route porte la `source` fournie (ou aucune si `undefined`). */
function fakeReflector(source: SourceScopeFoyer | undefined): Reflector {
  return { getAllAndOverride: () => source } as unknown as Reflector;
}

function fakeContext(req: RequeteScopable): ExecutionContext {
  return {
    switchToHttp: () => ({ getRequest: () => req }),
    getHandler: () => () => undefined,
    getClass: () => class {},
  } as unknown as ExecutionContext;
}

function requete(p: Partial<RequeteScopable> = {}): RequeteScopable {
  return { headers: {}, method: 'GET', originalUrl: '/api/x', ...p };
}

/** Résolveur factice : renvoie la portée programmée pour `(ressource, id)`, ou null. */
function fakeResolveur(
  portees: Record<string, PorteeRessource | null>,
): ResolveurFoyerRessource {
  return {
    resoudre: (ressource, id) =>
      Promise.resolve(portees[`${ressource}:${id}`] ?? null),
  };
}

/** Construit le guard avec la config d'assertion et le résolveur fournis. */
function guardAvec(
  assertion: ConfigAssertion,
  source: SourceScopeFoyer | undefined,
  resolveur?: ResolveurFoyerRessource,
): ScopeFoyerGuard {
  return new ScopeFoyerGuard(
    fakeReflector(source),
    { chargerConfig: () => ({ assertion }) },
    resolveur,
  );
}

const OBSERVE: ConfigAssertion = { secret: 's', enforce: false };
const ENFORCE: ConfigAssertion = { secret: 's', enforce: true };

/** Assertion parent (email + foyers) posée par le guard d'identité amont. */
function parent(
  email: string,
  foyers: readonly string[],
  admin = false,
): ChargeAssertion {
  return { v: 1, email, foyers, admin, iat: 0, exp: 0 };
}

describe('ScopeFoyerGuard', () => {
  afterEach(() => vi.restoreAllMocks());

  describe('court-circuits', () => {
    it('route non scopée (aucune source) → passe', async () => {
      const guard = guardAvec(ENFORCE, undefined);
      await expect(guard.canActivate(fakeContext(requete()))).resolves.toBe(
        true,
      );
    });

    it('secret absent (legacy) → passe sans scoping', async () => {
      const guard = guardAvec(
        { secret: undefined, enforce: false },
        {
          query: 'foyer',
        },
      );
      const req = requete({
        query: { foyer: FOYER_B },
        assertion: parent('p@x', [FOYER_A]),
      });
      await expect(guard.canActivate(fakeContext(req))).resolves.toBe(true);
    });

    it('assertion machine → bypass (appelant interne)', async () => {
      const guard = guardAvec(ENFORCE, { query: 'foyer' });
      const req = requete({
        query: { foyer: FOYER_B },
        assertion: { v: 1, machine: 'api-gateway', iat: 0, exp: 0 },
      });
      await expect(guard.canActivate(fakeContext(req))).resolves.toBe(true);
    });

    it('assertion parent admin → bypass', async () => {
      const guard = guardAvec(ENFORCE, { query: 'foyer' });
      const req = requete({
        query: { foyer: FOYER_B },
        assertion: parent('admin@x', [FOYER_A], true),
      });
      await expect(guard.canActivate(fakeContext(req))).resolves.toBe(true);
    });

    it('référence absente de la requête → laissé passer + log', async () => {
      const warn = vi.spyOn(Logger.prototype, 'warn');
      const guard = guardAvec(ENFORCE, { query: 'foyer' });
      const req = requete({ query: {}, assertion: parent('p@x', [FOYER_A]) });
      await expect(guard.canActivate(fakeContext(req))).resolves.toBe(true);
      expect(warn.mock.calls[0]?.[0]).toMatch(/référence introuvable/);
    });
  });

  describe('foyer direct (query/param/body)', () => {
    it('foyer couvert → passe', async () => {
      const guard = guardAvec(ENFORCE, { query: 'foyer' });
      const req = requete({
        query: { foyer: FOYER_A },
        assertion: parent('p@x', [FOYER_A]),
      });
      await expect(guard.canActivate(fakeContext(req))).resolves.toBe(true);
    });

    it('foyer étranger, enforce → 403', async () => {
      const guard = guardAvec(ENFORCE, { query: 'foyer' });
      const req = requete({
        query: { foyer: FOYER_B },
        assertion: parent('p@x', [FOYER_A]),
      });
      await expect(guard.canActivate(fakeContext(req))).rejects.toBeInstanceOf(
        ForbiddenException,
      );
    });

    it('foyer étranger, observe → « SCOPE AURAIT REFUSÉ » + passe', async () => {
      const warn = vi.spyOn(Logger.prototype, 'warn');
      const guard = guardAvec(OBSERVE, { param: 'id' });
      const req = requete({
        params: { id: FOYER_B },
        assertion: parent('p@x', [FOYER_A]),
      });
      await expect(guard.canActivate(fakeContext(req))).resolves.toBe(true);
      expect(warn.mock.calls[0]?.[0]).toMatch(/SCOPE AURAIT REFUSÉ/);
    });

    it('foyer depuis le body → couvert', async () => {
      const guard = guardAvec(ENFORCE, { body: 'foyerId' });
      const req = requete({
        body: { foyerId: FOYER_A },
        assertion: parent('p@x', [FOYER_A]),
      });
      await expect(guard.canActivate(fakeContext(req))).resolves.toBe(true);
    });
  });

  describe('e-mail direct (comparer: email)', () => {
    it('e-mail identique (insensible à la casse) → passe', async () => {
      const guard = guardAvec(ENFORCE, {
        body: 'createurEmail',
        comparer: 'email',
      });
      const req = requete({
        body: { createurEmail: 'Alex@Exemple.FR' },
        assertion: parent('alex@exemple.fr', []),
      });
      await expect(guard.canActivate(fakeContext(req))).resolves.toBe(true);
    });

    it('e-mail différent, enforce → 403', async () => {
      const guard = guardAvec(ENFORCE, {
        query: 'parentEmail',
        comparer: 'email',
      });
      const req = requete({
        query: { parentEmail: 'autre@exemple.fr' },
        assertion: parent('alex@exemple.fr', []),
      });
      await expect(guard.canActivate(fakeContext(req))).rejects.toBeInstanceOf(
        ForbiddenException,
      );
    });
  });

  describe('résolution locale (resoudre)', () => {
    it('contrat résolu vers un foyer couvert → passe', async () => {
      const resolveur = fakeResolveur({
        [`contrat:${CONTRAT}`]: { type: 'foyer', foyerId: FOYER_A },
      });
      const guard = guardAvec(
        ENFORCE,
        { resoudre: 'contrat', param: 'id' },
        resolveur,
      );
      const req = requete({
        params: { id: CONTRAT },
        assertion: parent('p@x', [FOYER_A]),
      });
      await expect(guard.canActivate(fakeContext(req))).resolves.toBe(true);
    });

    it('contrat résolu vers un foyer étranger, enforce → 403', async () => {
      const resolveur = fakeResolveur({
        [`contrat:${CONTRAT}`]: { type: 'foyer', foyerId: FOYER_B },
      });
      const guard = guardAvec(
        ENFORCE,
        { resoudre: 'contrat', query: 'contrat' },
        resolveur,
      );
      const req = requete({
        query: { contrat: CONTRAT },
        assertion: parent('p@x', [FOYER_A]),
      });
      await expect(guard.canActivate(fakeContext(req))).rejects.toBeInstanceOf(
        ForbiddenException,
      );
    });

    it('ressource inexistante (résolveur → null) → laissé passer (404 handler)', async () => {
      const resolveur = fakeResolveur({}); // rien → null
      const guard = guardAvec(
        ENFORCE,
        { resoudre: 'contrat', param: 'id' },
        resolveur,
      );
      const req = requete({
        params: { id: CONTRAT },
        assertion: parent('p@x', [FOYER_A]),
      });
      await expect(guard.canActivate(fakeContext(req))).resolves.toBe(true);
    });

    it('parent résolu vers un propriétaire = e-mail de l’assertion → passe', async () => {
      const parentId = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
      const resolveur = fakeResolveur({
        [`parent:${parentId}`]: {
          type: 'proprietaire',
          email: 'ALEX@exemple.fr',
        },
      });
      const guard = guardAvec(
        ENFORCE,
        { resoudre: 'parent', query: 'parent' },
        resolveur,
      );
      const req = requete({
        query: { parent: parentId },
        assertion: parent('alex@exemple.fr', [FOYER_A]),
      });
      await expect(guard.canActivate(fakeContext(req))).resolves.toBe(true);
    });

    it('parent résolu vers un autre propriétaire, enforce → 403', async () => {
      const parentId = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
      const resolveur = fakeResolveur({
        [`parent:${parentId}`]: {
          type: 'proprietaire',
          email: 'autre@exemple.fr',
        },
      });
      const guard = guardAvec(
        ENFORCE,
        { resoudre: 'parent', query: 'parent' },
        resolveur,
      );
      const req = requete({
        query: { parent: parentId },
        assertion: parent('alex@exemple.fr', [FOYER_A]),
      });
      await expect(guard.canActivate(fakeContext(req))).rejects.toBeInstanceOf(
        ForbiddenException,
      );
    });

    it('resoudre sans résolveur fourni → erreur de configuration', async () => {
      const guard = guardAvec(ENFORCE, { resoudre: 'contrat', param: 'id' });
      const req = requete({
        params: { id: CONTRAT },
        assertion: parent('p@x', [FOYER_A]),
      });
      await expect(guard.canActivate(fakeContext(req))).rejects.toThrow(
        /ResolveurFoyerRessource/,
      );
    });
  });

  describe('assertion absente (header manquant)', () => {
    it('observe → « SCOPE AURAIT REFUSÉ » et passe', async () => {
      const warn = vi.spyOn(Logger.prototype, 'warn');
      const guard = guardAvec(OBSERVE, { query: 'foyer' });
      const req = requete({ query: { foyer: FOYER_A } }); // pas de req.assertion
      await expect(guard.canActivate(fakeContext(req))).resolves.toBe(true);
      expect(warn.mock.calls[0]?.[0]).toMatch(/SCOPE AURAIT REFUSÉ/);
    });

    it('enforce (chemin défensif) → 403', async () => {
      const guard = guardAvec(ENFORCE, { query: 'foyer' });
      const req = requete({ query: { foyer: FOYER_A } });
      await expect(guard.canActivate(fakeContext(req))).rejects.toBeInstanceOf(
        ForbiddenException,
      );
    });
  });
});
