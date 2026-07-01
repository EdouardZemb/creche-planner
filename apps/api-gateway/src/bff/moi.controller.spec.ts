import {
  BadRequestException,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  type FoyerClient,
  type ParentVue,
  type PreferenceVue,
} from '../clients/foyer.client.js';
import {
  type InboxVue,
  type NotificationInAppVue,
  type NotificationsClient,
} from '../clients/notifications.client.js';
import { type RequeteIdentifiable } from '../security/identite.js';
import { MoiController } from './moi.controller.js';

function fakeFoyers(
  foyersParEmail: (email: string) => Promise<string[]>,
): FoyerClient {
  return { foyersParEmail: vi.fn(foyersParEmail) } as unknown as FoyerClient;
}

/** Fake `NotificationsClient` neutre (les tests d'inbox le surchargent au besoin). */
function fakeNotifs(
  over: Partial<NotificationsClient> = {},
): NotificationsClient {
  return {
    listerInbox: vi.fn(),
    marquerNotificationLue: vi.fn(),
    ...over,
  } as unknown as NotificationsClient;
}

function req(identite?: { email: string }): RequeteIdentifiable {
  return { headers: {}, ...(identite ? { identite } : {}) };
}

/** Fabrique une `ParentVue` minimale (identité douce nulle par défaut). */
function parent(
  over: Partial<ParentVue> & { id: string; email: string },
): ParentVue {
  return {
    foyerId: 'f-1',
    prenom: null,
    nom: null,
    principal: false,
    ordre: 0,
    actif: true,
    ...over,
  };
}

describe('MoiController (/api/v1/moi, PR6)', () => {
  let envInitial: NodeJS.ProcessEnv;

  beforeEach(() => {
    envInitial = { ...process.env };
    delete process.env['ADMIN_EMAILS'];
  });

  afterEach(() => {
    process.env = envInitial;
    vi.restoreAllMocks();
  });

  it('sans identité : email null, foyers vides, pas d’appel svc-foyer', async () => {
    const foyers = fakeFoyers(async () => ['f-1']);
    const moi = await new MoiController(foyers, fakeNotifs()).lire(req());
    expect(moi.email).toBeNull();
    expect(moi.foyers).toEqual([]);
    expect(foyers.foyersParEmail).not.toHaveBeenCalled();
  });

  it('gating inactif (allowlist vide) : admin permissif=true même sans identité', async () => {
    const moi = await new MoiController(
      fakeFoyers(async () => []),
      fakeNotifs(),
    ).lire(req());
    expect(moi.admin).toBe(true);
  });

  it('gating actif + identité admin : admin=true et foyers résolus', async () => {
    process.env['ADMIN_EMAILS'] = 'admin@example.test';
    const foyers = fakeFoyers(async () => ['f-1', 'f-2']);
    const moi = await new MoiController(foyers, fakeNotifs()).lire(
      req({ email: 'admin@example.test' }),
    );
    expect(moi).toEqual({
      email: 'admin@example.test',
      admin: true,
      foyers: ['f-1', 'f-2'],
    });
    expect(foyers.foyersParEmail).toHaveBeenCalledWith('admin@example.test');
  });

  it('gating actif + identité non-admin : admin=false, foyers bornés', async () => {
    process.env['ADMIN_EMAILS'] = 'admin@example.test';
    const foyers = fakeFoyers(async () => ['f-9']);
    const moi = await new MoiController(foyers, fakeNotifs()).lire(
      req({ email: 'parent@example.test' }),
    );
    expect(moi.admin).toBe(false);
    expect(moi.foyers).toEqual(['f-9']);
  });

  it('résolution svc-foyer en échec : foyers vides, ne lève pas', async () => {
    const foyers = fakeFoyers(async () => {
      throw new Error('svc-foyer indisponible');
    });
    const moi = await new MoiController(foyers, fakeNotifs()).lire(
      req({ email: 'parent@example.test' }),
    );
    expect(moi.email).toBe('parent@example.test');
    expect(moi.foyers).toEqual([]);
  });
});

const PREFS: PreferenceVue[] = [
  {
    typeNotification: 'VALIDATION_HEBDO',
    canal: 'EMAIL',
    actif: false,
    consentementAt: null,
    desabonneAt: null,
  },
  {
    typeNotification: 'VALIDATION_HEBDO',
    canal: 'IN_APP',
    actif: true,
    consentementAt: null,
    desabonneAt: null,
  },
];

describe('MoiController · /moi/profil + /moi/preferences (PR2)', () => {
  afterEach(() => vi.restoreAllMocks());

  it('profil sans identité : 401 (identité requise)', async () => {
    const foyers = { foyersParEmail: vi.fn() } as unknown as FoyerClient;
    await expect(
      new MoiController(foyers, fakeNotifs()).profil(req()),
    ).rejects.toBeInstanceOf(UnauthorizedException);
    expect(foyers.foyersParEmail).not.toHaveBeenCalled();
  });

  it('profil : résout SA ligne (défense) et agrège ses préférences', async () => {
    // Le foyer contient deux parents ; seule la ligne dont l'e-mail == identité
    // doit être retenue (jamais celle de l'autre parent).
    const autre = parent({
      id: 'p-autre',
      email: 'autre@example.test',
      prenom: 'Autre',
    });
    const moi = parent({
      id: 'p-moi',
      email: 'Moi@Example.test',
      prenom: 'Moi',
      principal: true,
    });
    const foyers = {
      foyersParEmail: vi.fn(async () => ['f-1']),
      parents: vi.fn(async () => [autre, moi]),
      preferences: vi.fn(async () => PREFS),
    } as unknown as FoyerClient;

    const vue = await new MoiController(foyers, fakeNotifs()).profil(
      // Casse différente : la résolution est insensible à la casse.
      req({ email: 'moi@example.test' }),
    );

    expect(vue).toEqual({
      parentId: 'p-moi',
      foyerId: 'f-1',
      email: 'Moi@Example.test',
      prenom: 'Moi',
      nom: null,
      principal: true,
      preferences: PREFS,
    });
    // Défense : les préférences sont lues pour MA ligne, pas celle de l'autre.
    expect(foyers.preferences).toHaveBeenCalledWith('f-1', 'p-moi');
  });

  it('profil : identité sans ligne parent correspondante → 404', async () => {
    const foyers = {
      foyersParEmail: vi.fn(async () => ['f-1']),
      parents: vi.fn(async () => [
        parent({ id: 'p-autre', email: 'autre@example.test' }),
      ]),
      preferences: vi.fn(),
    } as unknown as FoyerClient;

    await expect(
      new MoiController(foyers, fakeNotifs()).profil(
        req({ email: 'moi@example.test' }),
      ),
    ).rejects.toBeInstanceOf(NotFoundException);
    // On n'a jamais lu les préférences d'un parent qui n'est pas le mien.
    expect(foyers.preferences).not.toHaveBeenCalled();
  });

  it('preferences : met à jour SA ligne uniquement (parentId résolu, jamais fourni)', async () => {
    const autre = parent({ id: 'p-autre', email: 'autre@example.test' });
    const moi = parent({ id: 'p-moi', email: 'moi@example.test' });
    const majResultat: PreferenceVue[] = [
      { ...PREFS[0]!, actif: true, consentementAt: '2026-07-01T00:00:00.000Z' },
      PREFS[1]!,
    ];
    const foyers = {
      foyersParEmail: vi.fn(async () => ['f-1']),
      parents: vi.fn(async () => [autre, moi]),
      majPreferences: vi.fn(async () => majResultat),
    } as unknown as FoyerClient;

    const corps = {
      preferences: [
        { typeNotification: 'VALIDATION_HEBDO', canal: 'EMAIL', actif: true },
      ],
    };
    const vue = await new MoiController(foyers, fakeNotifs()).majPreferences(
      req({ email: 'moi@example.test' }),
      corps,
    );

    expect(vue).toEqual(majResultat);
    // Défense en profondeur : c'est bien MA ligne (p-moi) qui est modifiée.
    expect(foyers.majPreferences).toHaveBeenCalledWith('f-1', 'p-moi', corps);
  });

  it('preferences : corps invalide → 400 (avant tout appel amont)', async () => {
    const foyers = {
      foyersParEmail: vi.fn(),
      majPreferences: vi.fn(),
    } as unknown as FoyerClient;

    await expect(
      new MoiController(foyers, fakeNotifs()).majPreferences(
        req({ email: 'moi@example.test' }),
        {
          preferences: [
            { typeNotification: 'INCONNU', canal: 'EMAIL', actif: true },
          ],
        },
      ),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(foyers.majPreferences).not.toHaveBeenCalled();
  });

  it('preferences : liste vide → 400 (au moins une préférence)', async () => {
    const foyers = {
      foyersParEmail: vi.fn(),
      majPreferences: vi.fn(),
    } as unknown as FoyerClient;

    await expect(
      new MoiController(foyers, fakeNotifs()).majPreferences(
        req({ email: 'moi@example.test' }),
        {
          preferences: [],
        },
      ),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('preferences sans identité : 401', async () => {
    const foyers = { majPreferences: vi.fn() } as unknown as FoyerClient;
    await expect(
      new MoiController(foyers, fakeNotifs()).majPreferences(req(), {
        preferences: [],
      }),
    ).rejects.toBeInstanceOf(UnauthorizedException);
    expect(foyers.majPreferences).not.toHaveBeenCalled();
  });
});

const INBOX: InboxVue = {
  notifications: [
    {
      id: 'n1',
      type: 'VALIDATION_HEBDO',
      sujet: 'Planning de la semaine 2026-W27 à valider',
      corps: 'Le planning de Léa pour la semaine 2026-W27 est à valider.',
      creeLe: '2026-06-23T06:01:00.000Z',
      luLe: null,
    },
  ],
  nonLus: 1,
};

describe('MoiController · /moi/notifications (PR6 inbox in-app)', () => {
  afterEach(() => vi.restoreAllMocks());

  it('inbox sans identité : 401 (aucun appel amont)', async () => {
    const notifs = fakeNotifs();
    const foyers = { foyersParEmail: vi.fn() } as unknown as FoyerClient;
    await expect(
      new MoiController(foyers, notifs).notificationsInbox(req()),
    ).rejects.toBeInstanceOf(UnauthorizedException);
    expect(notifs.listerInbox).not.toHaveBeenCalled();
  });

  it('inbox : résout MON parentId (défense) puis relaie l’inbox amont', async () => {
    const autre = parent({ id: 'p-autre', email: 'autre@example.test' });
    const moi = parent({ id: 'p-moi', email: 'moi@example.test' });
    const foyers = {
      foyersParEmail: vi.fn(async () => ['f-1']),
      parents: vi.fn(async () => [autre, moi]),
    } as unknown as FoyerClient;
    const listerInbox = vi.fn(async () => INBOX);
    const notifs = fakeNotifs({ listerInbox });

    const vue = await new MoiController(foyers, notifs).notificationsInbox(
      req({ email: 'moi@example.test' }),
    );

    expect(vue).toEqual(INBOX);
    // Défense : c'est MON parentId (résolu serveur) qui est passé au service.
    expect(listerInbox).toHaveBeenCalledWith('p-moi');
  });

  it('inbox : identité sans ligne parent → 404 (pas d’appel amont)', async () => {
    const foyers = {
      foyersParEmail: vi.fn(async () => ['f-1']),
      parents: vi.fn(async () => [
        parent({ id: 'p-autre', email: 'autre@example.test' }),
      ]),
    } as unknown as FoyerClient;
    const notifs = fakeNotifs();

    await expect(
      new MoiController(foyers, notifs).notificationsInbox(
        req({ email: 'moi@example.test' }),
      ),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(notifs.listerInbox).not.toHaveBeenCalled();
  });

  it('marquer lu : résout MON parentId et scope l’écriture (jamais fourni par le client)', async () => {
    const lu: NotificationInAppVue = {
      ...INBOX.notifications[0]!,
      luLe: '2026-06-24T10:00:00.000Z',
    };
    const moi = parent({ id: 'p-moi', email: 'moi@example.test' });
    const foyers = {
      foyersParEmail: vi.fn(async () => ['f-1']),
      parents: vi.fn(async () => [moi]),
    } as unknown as FoyerClient;
    const marquerNotificationLue = vi.fn(async () => lu);
    const notifs = fakeNotifs({ marquerNotificationLue });

    const vue = await new MoiController(foyers, notifs).marquerNotificationLue(
      req({ email: 'moi@example.test' }),
      'n1',
    );

    expect(vue).toEqual(lu);
    // Défense : (parentId résolu serveur, id du chemin) — le client ne fournit pas le parent.
    expect(marquerNotificationLue).toHaveBeenCalledWith('p-moi', 'n1');
  });

  it('marquer lu sans identité : 401 (aucun appel amont)', async () => {
    const notifs = fakeNotifs();
    const foyers = { foyersParEmail: vi.fn() } as unknown as FoyerClient;
    await expect(
      new MoiController(foyers, notifs).marquerNotificationLue(req(), 'n1'),
    ).rejects.toBeInstanceOf(UnauthorizedException);
    expect(notifs.marquerNotificationLue).not.toHaveBeenCalled();
  });
});
