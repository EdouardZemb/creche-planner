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
import { ValidationController } from '../validation/validation.controller.js';
import { EnvoiController } from '../envoi/envoi.controller.js';
import { InboxController } from '../inbox/inbox.controller.js';

/**
 * Intégration du **scoping enforce** de svc-notifications (fondations lot 4). Couvre la
 * validation (résolution contrat → foyer), l'envoi au service (foyer direct — route
 * sensible : elle expédie un vrai mail, mais **seuls les guards** sont exercés ici, le
 * handler n'est jamais invoqué → aucun envoi) et l'inbox (résolution parent → e-mail
 * propriétaire, scopée au parent lui-même). `Reflector` réel sur les vraies méthodes.
 */

const SECRET = 'integ-notif-secret';
const ENFORCE: ConfigAssertion = { secret: SECRET, enforce: true };
const options = { chargerConfig: () => ({ assertion: ENFORCE }) };

const FOYER = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const AUTRE_FOYER = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const CONTRAT = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const PARENT = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
const EMAIL_PARENT = 'alex@exemple.fr';

function fakeResolveur(
  portees: Record<string, PorteeRessource | null>,
): ResolveurFoyerRessource {
  return {
    resoudre: (ressource, id) =>
      Promise.resolve(portees[`${ressource}:${id}`] ?? null),
  };
}

/** Résolveur nominal : contrat → FOYER, parent PARENT → e-mail EMAIL_PARENT. */
const RESOLVEUR = fakeResolveur({
  [`contrat:${CONTRAT}`]: { type: 'foyer', foyerId: FOYER },
  [`parent:${PARENT}`]: { type: 'proprietaire', email: EMAIL_PARENT },
});

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

async function chaine(c: ExecutionContext): Promise<boolean> {
  const reflector = new Reflector();
  const identite = new AssertionIdentiteGuard(reflector, options);
  const scope = new ScopeFoyerGuard(reflector, options, RESOLVEUR);
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
    originalUrl: '/api/validations',
    params: {},
    query: {},
    body: {},
    ...p,
  };
}

const VC = ValidationController.prototype;
const NC = EnvoiController.prototype;
const IC = InboxController.prototype;

describe('svc-notifications · scoping enforce', () => {
  describe('POST /validations/:contratId/:semaineIso (résolution contrat → foyer)', () => {
    it('contrat du foyer autorisé → passe (200)', async () => {
      const req = requete({
        method: 'POST',
        params: { contratId: CONTRAT, semaineIso: '2026-W27' },
        headers: entete({ email: 'p@x.fr', foyers: [FOYER] }),
      });
      await expect(
        chaine(ctx(ValidationController, VC.valider, req)),
      ).resolves.toBe(true);
    });

    it('contrat d’un foyer étranger → 403', async () => {
      const req = requete({
        method: 'POST',
        params: { contratId: CONTRAT, semaineIso: '2026-W27' },
        headers: entete({ email: 'p@x.fr', foyers: [AUTRE_FOYER] }),
      });
      await expect(
        chaine(ctx(ValidationController, VC.valider, req)),
      ).rejects.toBeInstanceOf(ForbiddenException);
    });

    it('sans en-tête → 401 ; machine → passe ; expirée → 401', async () => {
      const base = {
        method: 'POST',
        params: { contratId: CONTRAT, semaineIso: '2026-W27' },
      };
      await expect(
        chaine(ctx(ValidationController, VC.valider, requete(base))),
      ).rejects.toBeInstanceOf(UnauthorizedException);
      await expect(
        chaine(
          ctx(
            ValidationController,
            VC.valider,
            requete({ ...base, headers: entete({ machine: 'api-gateway' }) }),
          ),
        ),
      ).resolves.toBe(true);
      const expiree = new Date(Date.now() - 200_000);
      await expect(
        chaine(
          ctx(
            ValidationController,
            VC.valider,
            requete({
              ...base,
              headers: entete({ email: 'p@x.fr', foyers: [FOYER] }, expiree),
            }),
          ),
        ),
      ).rejects.toBeInstanceOf(UnauthorizedException);
    });

    it('contrat inexistant (résolveur → null) → passe (404 laissé au handler)', async () => {
      const req = requete({
        method: 'POST',
        params: {
          contratId: '99999999-9999-4999-8999-999999999999',
          semaineIso: '2026-W27',
        },
        headers: entete({ email: 'p@x.fr', foyers: [FOYER] }),
      });
      await expect(
        chaine(ctx(ValidationController, VC.valider, req)),
      ).resolves.toBe(true);
    });
  });

  describe('GET /validations/a-valider?foyer= (foyer direct)', () => {
    it('foyer étranger → 403', async () => {
      const req = requete({
        query: { foyer: FOYER },
        headers: entete({ email: 'p@x.fr', foyers: [AUTRE_FOYER] }),
      });
      await expect(
        chaine(ctx(ValidationController, VC.aValider, req)),
      ).rejects.toBeInstanceOf(ForbiddenException);
    });
  });

  describe('envoi au service (foyer direct — handler jamais invoqué, aucun mail)', () => {
    it('GET .../brouillon (param foyerId) foyer autorisé → passe', async () => {
      const req = requete({
        originalUrl:
          '/api/validations/semaine/f/2026-W27/etablissements/e/brouillon',
        params: {
          foyerId: FOYER,
          semaineIso: '2026-W27',
          etablissementId: ETAB(),
        },
        headers: entete({ email: 'p@x.fr', foyers: [FOYER] }),
      });
      await expect(
        chaine(ctx(EnvoiController, NC.brouillon, req)),
      ).resolves.toBe(true);
    });

    it('POST /envois/etablissement (body foyerId) foyer étranger → 403', async () => {
      const req = requete({
        method: 'POST',
        originalUrl: '/api/envois/etablissement',
        body: { foyerId: FOYER },
        headers: entete({ email: 'p@x.fr', foyers: [AUTRE_FOYER] }),
      });
      await expect(
        chaine(ctx(EnvoiController, NC.envoyer, req)),
      ).rejects.toBeInstanceOf(ForbiddenException);
    });
  });

  describe('GET/POST /moi/notifications?parent= (résolution parent → e-mail propriétaire)', () => {
    it('parent = identité (insensible à la casse) → passe', async () => {
      const req = requete({
        originalUrl: '/api/moi/notifications',
        query: { parent: PARENT },
        headers: entete({ email: 'ALEX@Exemple.fr', foyers: [FOYER] }),
      });
      await expect(chaine(ctx(InboxController, IC.lister, req))).resolves.toBe(
        true,
      );
    });

    it('parent d’un autre (co-parent) → 403 (scopé au parent lui-même)', async () => {
      const req = requete({
        method: 'POST',
        originalUrl: '/api/moi/notifications/n1/lu',
        params: { id: 'n1' },
        query: { parent: PARENT },
        headers: entete({ email: 'coparent@exemple.fr', foyers: [FOYER] }),
      });
      await expect(
        chaine(ctx(InboxController, IC.marquerLu, req)),
      ).rejects.toBeInstanceOf(ForbiddenException);
    });

    it('parent inexistant (résolveur → null) → passe (inbox vide / 404 au handler)', async () => {
      const req = requete({
        originalUrl: '/api/moi/notifications',
        query: { parent: '99999999-9999-4999-8999-999999999999' },
        headers: entete({ email: EMAIL_PARENT, foyers: [FOYER] }),
      });
      await expect(chaine(ctx(InboxController, IC.lister, req))).resolves.toBe(
        true,
      );
    });
  });
});

/** UUID d'établissement arbitraire (le brouillon ne le résout pas — foyerId direct). */
function ETAB(): string {
  return 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee';
}
