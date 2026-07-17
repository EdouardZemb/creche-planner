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
});
