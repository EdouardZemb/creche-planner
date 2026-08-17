import { Logger } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';
import { DestinatairesService } from './destinataires.service.js';
import type { Database } from '../database/database.types.js';

/**
 * Tests du service de résolution des destinataires, sans Postgres. La base factice
 * honore la forme `select().from().leftJoin().where()` et renvoie le jeu de lignes
 * **jointes** fourni (`{ email, principal, preferenceActive }`), où `preferenceActive`
 * matérialise le résultat de la jointure gauche sur `preference_notification` :
 * `null` = **pas de ligne**, `true`/`false` = consentement projeté. Le prédicat SQL
 * (`foyer + actif` + jointure `type/canal`) n'est pas évalué ici : on vérifie le
 * **filtre applicatif**, le **tri** (principal d'abord puis e-mail), le **mapping** vers
 * les seuls e-mails, et le cas vide (qui déclenchera le repli côté scheduler).
 *
 * ⚠️ Depuis `AM-57`, `null` **écarte** le parent au lieu de le conserver : le
 * consentement est écrit en amont (matérialisé à l'inscription, transporté par
 * `PreferencesNotifModifiees`) et ne se déduit plus d'une absence. Le cas nominal d'un
 * parent joignable est donc `preferenceActive: true`, valeur par défaut de `ligne()`.
 */

interface LigneJointe {
  parentId: string;
  email: string;
  principal: boolean;
  preferenceActive: boolean | null;
}

function ligne(partiel: Partial<LigneJointe> = {}): LigneJointe {
  return {
    parentId: 'parent-id',
    email: 'parent@test',
    principal: false,
    // Consentement projeté (cas nominal depuis `AM-57`) ; passer `null` pour le cas
    // « aucune ligne » et `false` pour un désabonnement explicite.
    preferenceActive: true,
    ...partiel,
  };
}

function fakeBase(lignes: LigneJointe[]): Database {
  return {
    select: () => ({
      from: () => ({
        leftJoin: () => ({
          where: () => Promise.resolve(lignes),
        }),
      }),
    }),
  } as unknown as Database;
}

const FOYER = '22222222-2222-4222-8222-222222222222';
const TYPE = 'VALIDATION_HEBDO' as const;

describe('DestinatairesService.emailsActifs', () => {
  it('place le principal en tête puis trie par e-mail', async () => {
    const service = new DestinatairesService(
      fakeBase([
        ligne({ email: 'zoe@test', principal: false }),
        ligne({ email: 'papa@test', principal: false }),
        ligne({ email: 'maman@test', principal: true }),
      ]),
    );

    await expect(service.emailsActifs(FOYER, TYPE)).resolves.toEqual([
      'maman@test',
      'papa@test',
      'zoe@test',
    ]);
  });

  it('foyer sans parent joignable : liste vide (repli côté appelant)', async () => {
    const service = new DestinatairesService(fakeBase([]));
    await expect(service.emailsActifs(FOYER, TYPE)).resolves.toEqual([]);
  });

  it('un seul parent : sa seule adresse', async () => {
    const service = new DestinatairesService(
      fakeBase([ligne({ email: 'seul@test' })]),
    );
    await expect(service.emailsActifs(FOYER, TYPE)).resolves.toEqual([
      'seul@test',
    ]);
  });

  it('préférence e-mail coupée (actif=false) : le parent est retiré des destinataires', async () => {
    const service = new DestinatairesService(
      fakeBase([
        ligne({ email: 'maman@test', principal: true, preferenceActive: true }),
        ligne({ email: 'papa@test', preferenceActive: false }), // a coupé l'e-mail
      ]),
    );

    await expect(service.emailsActifs(FOYER, TYPE)).resolves.toEqual([
      'maman@test',
    ]);
  });

  it('préférence explicitement active (actif=true) : le parent est conservé', async () => {
    const service = new DestinatairesService(
      fakeBase([ligne({ email: 'optin@test', preferenceActive: true })]),
    );
    await expect(service.emailsActifs(FOYER, TYPE)).resolves.toEqual([
      'optin@test',
    ]);
  });

  it('AUCUNE ligne projetée : le parent écarté est NOMMÉ dans les journaux', async () => {
    // Fermer le filtre sans le dire, c'est échanger un réabonnement silencieux contre
    // un abandon silencieux. Un désabonnement, lui, est un CHOIX : il ne se loggue pas.
    const warn = vi
      .spyOn(Logger.prototype, 'warn')
      .mockImplementation(() => undefined);
    const service = new DestinatairesService(
      fakeBase([
        ligne({ parentId: 'p-sans-ligne', preferenceActive: null }),
        ligne({ parentId: 'p-desabonne', preferenceActive: false }),
      ]),
    );

    await service.emailsActifs(FOYER, TYPE);

    expect(warn).toHaveBeenCalledTimes(1);
    const message = String(warn.mock.calls[0]?.[0]);
    expect(message).toContain('p-sans-ligne');
    expect(message).not.toContain('p-desabonne');
    warn.mockRestore();
  });

  it('AUCUNE ligne projetée (purge, effacement) : le parent est écarté, jamais réabonné', async () => {
    // Sonde négative d'`AM-57`. Avant ce lot, `null` valait consentement : supprimer
    // la ligne d'un parent désabonné le remettait dans la liste d'envoi — exactement
    // la population que la borne T3bis (doc 37) visait. Le courriel part vers un
    // destinataire réel : le filtre doit se fermer, pas s'ouvrir, sur l'inconnu.
    const service = new DestinatairesService(
      fakeBase([
        ligne({ email: 'consentant@test', preferenceActive: true }),
        ligne({ email: 'ligne-supprimee@test', preferenceActive: null }),
      ]),
    );
    await expect(service.emailsActifs(FOYER, TYPE)).resolves.toEqual([
      'consentant@test',
    ]);
  });

  it('tous les parents ont coupé l’e-mail : liste vide (repli côté appelant)', async () => {
    const service = new DestinatairesService(
      fakeBase([
        ligne({ email: 'maman@test', preferenceActive: false }),
        ligne({ email: 'papa@test', preferenceActive: false }),
      ]),
    );
    await expect(service.emailsActifs(FOYER, TYPE)).resolves.toEqual([]);
  });
});

describe('DestinatairesService.destinatairesActifs', () => {
  it('rend le parentId + e-mail de chaque destinataire (jeton de désabonnement PR5)', async () => {
    const service = new DestinatairesService(
      fakeBase([
        ligne({ parentId: 'p-zoe', email: 'zoe@test', principal: false }),
        ligne({ parentId: 'p-maman', email: 'maman@test', principal: true }),
      ]),
    );

    // Principal d'abord (comme `emailsActifs`), avec le parentId conservé.
    await expect(service.destinatairesActifs(FOYER, TYPE)).resolves.toEqual([
      { parentId: 'p-maman', email: 'maman@test' },
      { parentId: 'p-zoe', email: 'zoe@test' },
    ]);
  });
});

describe('DestinatairesService.destinatairesInApp', () => {
  it('rend les parentId dont le canal in-app est explicitement actif', async () => {
    const service = new DestinatairesService(
      fakeBase([
        ligne({ parentId: 'p1' }), // consentement projeté
        ligne({ parentId: 'p2', preferenceActive: true }), // opt-in explicite
      ]),
    );
    await expect(service.destinatairesInApp(FOYER, TYPE)).resolves.toEqual([
      'p1',
      'p2',
    ]);
  });

  it('canal in-app coupé (actif=false) : le parent est retiré', async () => {
    const service = new DestinatairesService(
      fakeBase([
        ligne({ parentId: 'p1', preferenceActive: true }),
        ligne({ parentId: 'p2', preferenceActive: false }), // a coupé l'in-app
      ]),
    );
    await expect(service.destinatairesInApp(FOYER, TYPE)).resolves.toEqual([
      'p1',
    ]);
  });

  it('AUCUNE ligne projetée : pas d’entrée d’inbox non plus (même règle fermée)', async () => {
    const service = new DestinatairesService(
      fakeBase([
        ligne({ parentId: 'p1', preferenceActive: true }),
        ligne({ parentId: 'p2', preferenceActive: null }),
      ]),
    );
    await expect(service.destinatairesInApp(FOYER, TYPE)).resolves.toEqual([
      'p1',
    ]);
  });

  it('foyer sans parent : liste vide (aucune entrée d’inbox)', async () => {
    const service = new DestinatairesService(fakeBase([]));
    await expect(service.destinatairesInApp(FOYER, TYPE)).resolves.toEqual([]);
  });
});
