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
  type PorteeRessource,
  type ResolveurFoyerRessource,
} from '@creche-planner/nest-commons';
import { PlanificationController } from '../planification/planification.controller.js';
import { EtablissementController } from '../etablissement/etablissement.controller.js';
import { CalendrierController } from '../calendrier/calendrier.controller.js';
import { PortabiliteController } from '../portabilite/portabilite.controller.js';

/**
 * Intégration du **scoping enforce** de svc-planification (fondations lot 4). Les routes
 * `/contrats/:id…` et `/etablissements/:id` ne portent pas le foyer → résolution locale
 * (contrat/établissement → foyer). On câble la vraie chaîne identité → scope avec un
 * `Reflector` réel lisant les métadonnées des vraies méthodes des deux contrôleurs, et
 * un résolveur factice simulant la table (une portée programmée par `(ressource, id)`,
 * `null` pour l'absence → 404 laissé au handler).
 */

const SECRET = 'integ-planif-secret';
const ENFORCE: ConfigAssertion = { secret: SECRET, enforce: true };
const options = { chargerConfig: () => ({ assertion: ENFORCE }) };

const FOYER = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const AUTRE_FOYER = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const CONTRAT = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const ETAB = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee';

function fakeResolveur(
  portees: Record<string, PorteeRessource | null>,
): ResolveurFoyerRessource {
  return {
    resoudre: (ressource, id) =>
      Promise.resolve(portees[`${ressource}:${id}`] ?? null),
  };
}

function ctx(
  ClasseCtrl: unknown,
  methode: (...args: never[]) => unknown,
  req: Record<string, unknown>,
): ExecutionContext {
  return {
    switchToHttp: () => ({ getRequest: () => req }),
    getHandler: () => methode,
    getClass: () => ClasseCtrl,
  } as unknown as ExecutionContext;
}

async function chaine(
  c: ExecutionContext,
  resolveur?: ResolveurFoyerRessource,
): Promise<boolean> {
  const reflector = new Reflector();
  const identite = new AssertionIdentiteGuard(reflector, options);
  const scope = new ScopeFoyerGuard(reflector, options, resolveur);
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
    originalUrl: '/api/contrats',
    params: {},
    query: {},
    body: {},
    ...p,
  };
}

/** Résolveur nominal : le contrat/établissement de référence appartient à `FOYER`. */
const RESOLVEUR = fakeResolveur({
  [`contrat:${CONTRAT}`]: { type: 'foyer', foyerId: FOYER },
  [`etablissement:${ETAB}`]: { type: 'foyer', foyerId: FOYER },
});

const PC = PlanificationController.prototype;
const EC = EtablissementController.prototype;
const XC = PortabiliteController.prototype;
const CC = CalendrierController.prototype;

describe('svc-planification · scoping enforce', () => {
  describe('GET /contrats/:id (résolution contrat → foyer)', () => {
    it('contrat du foyer autorisé → passe (200)', async () => {
      const req = requete({
        params: { id: CONTRAT },
        headers: entete({ email: 'p@x.fr', foyers: [FOYER] }),
      });
      await expect(
        chaine(ctx(PlanificationController, PC.lireContrat, req), RESOLVEUR),
      ).resolves.toBe(true);
    });

    it('contrat d’un foyer étranger → 403', async () => {
      const req = requete({
        params: { id: CONTRAT },
        headers: entete({ email: 'p@x.fr', foyers: [AUTRE_FOYER] }),
      });
      await expect(
        chaine(ctx(PlanificationController, PC.lireContrat, req), RESOLVEUR),
      ).rejects.toBeInstanceOf(ForbiddenException);
    });

    it('sans en-tête → 401 (guard identité amont)', async () => {
      const req = requete({ params: { id: CONTRAT } });
      await expect(
        chaine(ctx(PlanificationController, PC.lireContrat, req), RESOLVEUR),
      ).rejects.toBeInstanceOf(UnauthorizedException);
    });

    it('assertion machine → passe (bypass, sans résolution)', async () => {
      const req = requete({
        params: { id: CONTRAT },
        headers: entete({ machine: 'api-gateway' }),
      });
      await expect(
        chaine(ctx(PlanificationController, PC.lireContrat, req), RESOLVEUR),
      ).resolves.toBe(true);
    });

    it('assertion expirée → 401 (guard identité amont)', async () => {
      const expiree = new Date(Date.now() - 200_000);
      const req = requete({
        params: { id: CONTRAT },
        headers: entete({ email: 'p@x.fr', foyers: [FOYER] }, expiree),
      });
      await expect(
        chaine(ctx(PlanificationController, PC.lireContrat, req), RESOLVEUR),
      ).rejects.toBeInstanceOf(UnauthorizedException);
    });

    it('contrat inexistant (résolveur → null) → passe (404 laissé au handler, pas 403)', async () => {
      const req = requete({
        params: { id: '99999999-9999-4999-8999-999999999999' },
        headers: entete({ email: 'p@x.fr', foyers: [FOYER] }),
      });
      await expect(
        chaine(ctx(PlanificationController, PC.lireContrat, req), RESOLVEUR),
      ).resolves.toBe(true);
    });
  });

  describe('GET /prestations?contrat= (résolution contrat via query)', () => {
    it('contrat étranger → 403', async () => {
      const req = requete({
        originalUrl: '/api/prestations',
        query: { contrat: CONTRAT },
        headers: entete({ email: 'p@x.fr', foyers: [AUTRE_FOYER] }),
      });
      await expect(
        chaine(ctx(PlanificationController, PC.prestations, req), RESOLVEUR),
      ).rejects.toBeInstanceOf(ForbiddenException);
    });
  });

  describe('GET /contrats?foyer= (foyer direct)', () => {
    it('foyer autorisé → passe', async () => {
      const req = requete({
        query: { foyer: FOYER },
        headers: entete({ email: 'p@x.fr', foyers: [FOYER] }),
      });
      await expect(
        chaine(ctx(PlanificationController, PC.listerContrats, req), RESOLVEUR),
      ).resolves.toBe(true);
    });

    it('foyer étranger → 403', async () => {
      const req = requete({
        query: { foyer: FOYER },
        headers: entete({ email: 'p@x.fr', foyers: [AUTRE_FOYER] }),
      });
      await expect(
        chaine(ctx(PlanificationController, PC.listerContrats, req), RESOLVEUR),
      ).rejects.toBeInstanceOf(ForbiddenException);
    });
  });

  describe('POST /contrats (foyerId body)', () => {
    it('foyer étranger dans le corps → 403', async () => {
      const req = requete({
        method: 'POST',
        body: { foyerId: FOYER },
        headers: entete({ email: 'p@x.fr', foyers: [AUTRE_FOYER] }),
      });
      await expect(
        chaine(ctx(PlanificationController, PC.creerContrat, req), RESOLVEUR),
      ).rejects.toBeInstanceOf(ForbiddenException);
    });
  });

  describe('GET /foyers/:foyerId/export (foyer direct — portabilité, lot 3)', () => {
    it('export de son propre foyer → passe', async () => {
      const req = requete({
        originalUrl: `/api/foyers/${FOYER}/export`,
        params: { foyerId: FOYER },
        headers: entete({ email: 'p@x.fr', foyers: [FOYER] }),
      });
      await expect(
        chaine(ctx(PortabiliteController, XC.exporter, req), RESOLVEUR),
      ).resolves.toBe(true);
    });

    it('export du foyer d’autrui → 403 (la portabilité ne perce pas l’isolation)', async () => {
      const req = requete({
        originalUrl: `/api/foyers/${FOYER}/export`,
        params: { foyerId: FOYER },
        headers: entete({ email: 'p@x.fr', foyers: [AUTRE_FOYER] }),
      });
      await expect(
        chaine(ctx(PortabiliteController, XC.exporter, req), RESOLVEUR),
      ).rejects.toBeInstanceOf(ForbiddenException);
    });

    it('sans en-tête → 401 (guard identité amont)', async () => {
      const req = requete({
        originalUrl: `/api/foyers/${FOYER}/export`,
        params: { foyerId: FOYER },
      });
      await expect(
        chaine(ctx(PortabiliteController, XC.exporter, req), RESOLVEUR),
      ).rejects.toBeInstanceOf(UnauthorizedException);
    });
  });

  describe('GET /etablissements/:id (résolution établissement → foyer)', () => {
    it('établissement du foyer autorisé → passe', async () => {
      const req = requete({
        originalUrl: '/api/etablissements/x',
        params: { id: ETAB },
        headers: entete({ email: 'p@x.fr', foyers: [FOYER] }),
      });
      await expect(
        chaine(ctx(EtablissementController, EC.parId, req), RESOLVEUR),
      ).resolves.toBe(true);
    });

    it('établissement d’un foyer étranger → 403', async () => {
      const req = requete({
        originalUrl: '/api/etablissements/x',
        params: { id: ETAB },
        headers: entete({ email: 'p@x.fr', foyers: [AUTRE_FOYER] }),
      });
      await expect(
        chaine(ctx(EtablissementController, EC.parId, req), RESOLVEUR),
      ).rejects.toBeInstanceOf(ForbiddenException);
    });
  });

  /**
   * Calendrier d'ouverture (SFD 31, lot 2). Toutes ses routes se résolvent par la
   * MÊME ressource que le CRUD établissement (`etablissement → foyer`), sans
   * nouveau résolveur — c'est le patron du chantier fondations, réutilisé.
   *
   * On balaye ici **toutes** les méthodes du contrôleur, énumérées depuis son
   * prototype : le verdict porte donc aussi sur les routes qu'on ajouterait
   * demain. Une liste écrite à la main ne dirait rien de celle qu'on aurait
   * oublié d'y mettre, et c'est précisément la route oubliée qui ouvrirait le
   * calendrier d'un foyer étranger.
   */
  describe('… /etablissements/:id/calendrier* (mêmes résolution et verdicts)', () => {
    const handlers = CC as unknown as Record<string, () => unknown>;
    const routes = Object.getOwnPropertyNames(CalendrierController.prototype)
      .filter((nom) => nom !== 'constructor')
      .flatMap((nom) => {
        const methode = handlers[nom];
        return methode === undefined ? [] : [[nom, methode] as const];
      });

    it('voit bien les onze routes du calendrier (sonde de la sonde)', () => {
      // 10 au lot 2, + `POST import` au lot 3. Ce compte est la SONDE de la suite
      // ci-dessous : sans lui, ajouter une route non scopée passerait inaperçu —
      // `it.each` ne testerait simplement pas ce qu'il ne voit pas.
      expect(routes).toHaveLength(11);
    });

    it.each(routes)('%s — foyer autorisé → passe', async (_nom, methode) => {
      const req = requete({
        originalUrl: '/api/etablissements/x/calendrier',
        params: { id: ETAB },
        headers: entete({ email: 'p@x.fr', foyers: [FOYER] }),
      });
      await expect(
        chaine(ctx(CalendrierController, methode, req), RESOLVEUR),
      ).resolves.toBe(true);
    });

    it.each(routes)('%s — foyer étranger → 403', async (_nom, methode) => {
      const req = requete({
        originalUrl: '/api/etablissements/x/calendrier',
        params: { id: ETAB },
        headers: entete({ email: 'p@x.fr', foyers: [AUTRE_FOYER] }),
      });
      await expect(
        chaine(ctx(CalendrierController, methode, req), RESOLVEUR),
      ).rejects.toBeInstanceOf(ForbiddenException);
    });

    it('établissement inexistant → le guard laisse le handler rendre son 404', async () => {
      const req = requete({
        originalUrl: '/api/etablissements/x/calendrier',
        params: { id: 'ffffffff-ffff-4fff-8fff-ffffffffffff' },
        headers: entete({ email: 'p@x.fr', foyers: [FOYER] }),
      });
      await expect(
        chaine(ctx(CalendrierController, CC.lire, req), RESOLVEUR),
      ).resolves.toBe(true);
    });
  });
});
