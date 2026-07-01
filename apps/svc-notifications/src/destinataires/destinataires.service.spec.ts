import { describe, expect, it } from 'vitest';
import { DestinatairesService } from './destinataires.service.js';
import type { Database } from '../database/database.types.js';

/**
 * Tests du service de résolution des destinataires, sans Postgres. La base factice
 * honore la forme `select().from().leftJoin().where()` et renvoie le jeu de lignes
 * **jointes** fourni (`{ email, principal, preferenceActive }`), où `preferenceActive`
 * matérialise le résultat de la jointure gauche sur `preference_notification` :
 * `null` = pas de ligne (défaut applicatif §5.1), `true`/`false` = préférence explicite.
 * Le prédicat SQL (`foyer + actif` + jointure `type/canal`) n'est pas évalué ici : on
 * vérifie le **filtre applicatif** (préférence coupée ⇒ parent retiré, ligne absente ⇒
 * conservé), le **tri** (principal d'abord puis e-mail), le **mapping** vers les seuls
 * e-mails, et le cas vide (qui déclenchera le repli côté scheduler).
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
    preferenceActive: null,
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
  it('place le principal en tête puis trie par e-mail (préférence absente = défaut)', async () => {
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
