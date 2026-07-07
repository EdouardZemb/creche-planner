import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { MailerService } from '@creche-planner/nest-commons';
import { SchedulerHebdo } from './scheduler.hebdo.js';
import type { Clock } from './clock.js';
import type { OptionsScheduler } from './scheduler.options.js';
import type { Database } from '../database/database.types.js';
import type { ContratRow } from '../database/schema.js';
import type { ValidationService } from '../validation/validation.service.js';
import type {
  DestinataireActif,
  DestinatairesService,
} from '../destinataires/destinataires.service.js';
import type { DesabonnementClient } from '../desabonnement/desabonnement.client.js';
import type { InboxService } from '../inbox/inbox.service.js';
import type {
  EtablissementProjeteService,
  EtablissementProjeteVue,
} from '../etablissement/etablissement-projete.service.js';

/**
 * Tests du scheduler du mardi avec **horloge mockée** (jamais `new Date()` dans la
 * logique) et sans Postgres ni SMTP : `ValidationService`, `EtablissementProjeteService`,
 * `DestinatairesService`, `DesabonnementClient` et `MailerService` sont des doubles
 * vitest, la base ne sert qu'à lister les contrats actifs (le prédicat drizzle n'est pas
 * évalué — la fonction renvoie le jeu fourni).
 *
 * Couvre PR4 « parents du foyer » **et** PR5 « désabonnement RFC 8058 » : idempotence
 * figée **par contrat**, **un mail par destinataire** (jeton one-shot + en-tête
 * `List-Unsubscribe` propres au parent), **repli** sur `NOTIF_EMAIL_PARENT` (un seul
 * mail, sans désabonnement) si le foyer n'a aucun parent joignable, **dégradation
 * propre** (mail sans en-tête) si la frappe du jeton échoue.
 *
 * Instants de référence (`Europe/Paris` est en CEST = UTC+2 en juin) :
 * - mardi 2026-06-23 08:01 Paris = 2026-06-23T06:01:00Z → dans la fenêtre ;
 * - lundi 2026-06-22 08:01 Paris → hors fenêtre (pas mardi) ;
 * - mardi 2026-06-23 07:00 Paris → hors fenêtre (avant l'heure).
 * La semaine N+1 du mardi 2026-06-23 (semaine W26) est **2026-W27**.
 */

const MARDI_8H01 = '2026-06-23T06:01:00.000Z';
const LUNDI_8H01 = '2026-06-22T06:01:00.000Z';
const MARDI_7H00 = '2026-06-23T05:00:00.000Z';
const SEMAINE_N1 = '2026-W27';
const FOYER_A = '22222222-2222-4222-8222-222222222222';
const FOYER_B = '33333333-3333-4333-8333-333333333333';
// Établissements réels (read model `etablissement`), reliés aux contrats par `etablissementId`.
const ETAB_CRECHE_ID = '99999999-9999-4999-8999-999999999991';
const ETAB_ABCM_ID = '99999999-9999-4999-8999-999999999992';

function horloge(iso: string): Clock {
  return { maintenant: () => new Date(iso) };
}

const OPTIONS: OptionsScheduler = {
  heureDeclenchement: 8,
  forcerFenetre: false,
  emailParent: 'parent@test',
  appUrl: 'https://app.test',
  publicApiUrl: 'https://api.test',
  unsubscribeMailto: '',
};

function contratRow(partiel: Partial<ContratRow> = {}): ContratRow {
  return {
    id: '55555555-0000-4000-8000-000000000000',
    foyerId: FOYER_A,
    enfant: 'Léa',
    mode: 'CRECHE_PSU',
    etablissementId: null,
    valideDu: '2026-01-01',
    valideAu: null,
    updatedAt: new Date('2026-01-01T00:00:00.000Z'),
    ...partiel,
  };
}

/** Base factice : `select().from().where()` renvoie le jeu de contrats fourni. */
function fakeBase(contrats: ContratRow[]): Database {
  return {
    select: () => ({
      from: () => ({
        where: () => Promise.resolve(contrats),
      }),
    }),
  } as unknown as Database;
}

const ETAB_CRECHE: EtablissementProjeteVue = {
  id: ETAB_CRECHE_ID,
  foyerId: FOYER_A,
  nom: 'Crèche Les Hirondelles',
  emailService: 'creche@test',
  preavisRegle: { type: 'JOURS_OUVRES', valeur: 2 },
  actif: true,
};
const ETAB_ABCM: EtablissementProjeteVue = {
  id: ETAB_ABCM_ID,
  foyerId: FOYER_A,
  nom: 'École ABCM',
  emailService: 'abcm@test',
  preavisRegle: { type: 'JOUR_HEURE', jour: 'JEUDI', heure: '12:00' },
  actif: true,
};

interface Doubles {
  validation: ValidationService;
  notifier: ReturnType<typeof vi.fn>;
  etablissements: EtablissementProjeteService;
  destinataires: DestinatairesService;
  destinatairesActifs: ReturnType<typeof vi.fn>;
  destinatairesInApp: ReturnType<typeof vi.fn>;
  desabonnement: DesabonnementClient;
  emettreJeton: ReturnType<typeof vi.fn>;
  inbox: InboxService;
  creerInApp: ReturnType<typeof vi.fn>;
  mailer: MailerService;
  envoyer: ReturnType<typeof vi.fn>;
}

function doubles(
  annuaire: EtablissementProjeteVue[] = [ETAB_CRECHE],
  destinatairesActifsListe: DestinataireActif[] = [],
  token: string | undefined = 'jeton-abc',
  destinatairesInAppListe: string[] = [],
): Doubles {
  const notifier = vi.fn(() => Promise.resolve(true));
  const destinatairesActifs = vi.fn(() =>
    Promise.resolve(destinatairesActifsListe),
  );
  const destinatairesInApp = vi.fn(() =>
    Promise.resolve(destinatairesInAppListe),
  );
  const emettreJeton = vi.fn(() => Promise.resolve(token));
  const creerInApp = vi.fn(() => Promise.resolve());
  const envoyer = vi.fn(() =>
    Promise.resolve({ messageId: null, dryRun: true }),
  );
  return {
    validation: { notifier } as unknown as ValidationService,
    notifier,
    etablissements: {
      lister: vi.fn(() => Promise.resolve(annuaire)),
    } as unknown as EtablissementProjeteService,
    destinataires: {
      destinatairesActifs,
      destinatairesInApp,
    } as unknown as DestinatairesService,
    destinatairesActifs,
    destinatairesInApp,
    desabonnement: { emettreJeton } as unknown as DesabonnementClient,
    emettreJeton,
    inbox: { creer: creerInApp } as unknown as InboxService,
    creerInApp,
    mailer: { envoyer } as unknown as MailerService,
    envoyer,
  };
}

function scheduler(
  iso: string,
  contrats: ContratRow[],
  d: Doubles,
  options: OptionsScheduler = OPTIONS,
) {
  return new SchedulerHebdo(
    horloge(iso),
    fakeBase(contrats),
    options,
    d.validation,
    d.etablissements,
    d.destinataires,
    d.desabonnement,
    d.inbox,
    d.mailer,
  );
}

describe('SchedulerHebdo.declencher', () => {
  let d: Doubles;
  beforeEach(() => {
    d = doubles();
  });

  it('mardi ≥ heure (Paris) : notifie la semaine N+1 et envoie le récap', async () => {
    await scheduler(MARDI_8H01, [contratRow()], d).declencher();

    expect(d.notifier).toHaveBeenCalledTimes(1);
    expect(d.notifier).toHaveBeenCalledWith({
      contratId: '55555555-0000-4000-8000-000000000000',
      foyerId: FOYER_A,
      semaineIso: SEMAINE_N1,
    });
    expect(d.envoyer).toHaveBeenCalledTimes(1);
    const message = d.envoyer.mock.calls[0]?.[0] as {
      to: string;
      subject: string;
    };
    expect(message.subject).toBe(
      `Valider le planning de la semaine ${SEMAINE_N1}`,
    );
  });

  it('repli : foyer sans parent → un mail vers NOTIF_EMAIL_PARENT, sans en-tête ni jeton', async () => {
    await scheduler(MARDI_8H01, [contratRow()], d).declencher();

    expect(d.destinatairesActifs).toHaveBeenCalledWith(
      FOYER_A,
      'VALIDATION_HEBDO',
    );
    const message = d.envoyer.mock.calls[0]?.[0] as {
      to: string;
      headers?: unknown;
    };
    expect(message.to).toBe('parent@test');
    // Le repli n'est pas un parent réel : ni jeton, ni en-tête de désabonnement.
    expect(message.headers).toBeUndefined();
    expect(d.emettreJeton).not.toHaveBeenCalled();
  });

  it('un mail par parent actif, chacun avec son en-tête List-Unsubscribe (RFC 8058)', async () => {
    const dd = doubles(
      [ETAB_CRECHE],
      [
        { parentId: 'p1', email: 'maman@test' },
        { parentId: 'p2', email: 'papa@test' },
      ],
    );
    await scheduler(MARDI_8H01, [contratRow()], dd).declencher();

    // Un mail distinct par destinataire (et non un `to` groupé).
    expect(dd.envoyer).toHaveBeenCalledTimes(2);
    const tos = dd.envoyer.mock.calls.map((c) => (c[0] as { to: string }).to);
    expect(tos).toEqual(['maman@test', 'papa@test']);

    // Jeton frappé par parent (lié au triplet parent/type/canal).
    expect(dd.emettreJeton).toHaveBeenCalledWith({
      foyerId: FOYER_A,
      parentId: 'p1',
      typeNotification: 'VALIDATION_HEBDO',
      canal: 'EMAIL',
    });

    // En-têtes RFC 8058 : lien one-click HTTPS vers la gateway + one-click POST.
    const premier = dd.envoyer.mock.calls[0]?.[0] as {
      headers?: Record<string, string>;
    };
    expect(premier.headers?.['List-Unsubscribe']).toContain(
      'https://api.test/api/v1/desabonnement?token=jeton-abc',
    );
    expect(premier.headers?.['List-Unsubscribe-Post']).toBe(
      'List-Unsubscribe=One-Click',
    );
  });

  it('jeton indisponible : le mail part quand même, sans en-tête ni lien (dégradation propre)', async () => {
    const dd = doubles([ETAB_CRECHE], [{ parentId: 'p1', email: 'solo@test' }]);
    // Frappe du jeton indisponible (svc-foyer injoignable) ⇒ dégradation propre.
    dd.emettreJeton.mockResolvedValue(undefined);
    await scheduler(MARDI_8H01, [contratRow()], dd).declencher();

    expect(dd.envoyer).toHaveBeenCalledTimes(1);
    const message = dd.envoyer.mock.calls[0]?.[0] as {
      to: string;
      headers?: unknown;
      text: string;
    };
    expect(message.to).toBe('solo@test');
    expect(message.headers).toBeUndefined();
    expect(message.text).not.toContain('/desabonnement');
  });

  it('regroupe les contrats d’un même foyer en UN mail par parent (enfants groupés)', async () => {
    const dd = doubles([ETAB_CRECHE], [{ parentId: 'p1', email: 'solo@test' }]);
    await scheduler(
      MARDI_8H01,
      [
        contratRow({ id: 'c1', enfant: 'Léa', mode: 'CRECHE_PSU' }),
        contratRow({ id: 'c2', enfant: 'Tom', mode: 'CRECHE_PSU' }),
      ],
      dd,
    ).declencher();

    // Idempotence figée PAR CONTRAT (2 appels) mais UN mail (un seul parent).
    expect(dd.notifier).toHaveBeenCalledTimes(2);
    expect(dd.envoyer).toHaveBeenCalledTimes(1);
    const message = dd.envoyer.mock.calls[0]?.[0] as { text: string };
    expect(message.text).toContain('Léa');
    expect(message.text).toContain('Tom');
  });

  it('foyers distincts : au moins un envoi par foyer (repli chacun)', async () => {
    await scheduler(
      MARDI_8H01,
      [
        contratRow({ id: 'c1', foyerId: FOYER_A, enfant: 'Léa' }),
        contratRow({ id: 'c2', foyerId: FOYER_B, enfant: 'Noé' }),
      ],
      d,
    ).declencher();

    expect(d.envoyer).toHaveBeenCalledTimes(2);
    expect(d.destinatairesActifs).toHaveBeenCalledWith(
      FOYER_A,
      'VALIDATION_HEBDO',
    );
    expect(d.destinatairesActifs).toHaveBeenCalledWith(
      FOYER_B,
      'VALIDATION_HEBDO',
    );
  });

  it('un lundi : ne déclenche rien', async () => {
    await scheduler(LUNDI_8H01, [contratRow()], d).declencher();

    expect(d.notifier).not.toHaveBeenCalled();
    expect(d.envoyer).not.toHaveBeenCalled();
  });

  it('mardi mais avant l’heure : ne déclenche rien', async () => {
    await scheduler(MARDI_7H00, [contratRow()], d).declencher();

    expect(d.notifier).not.toHaveBeenCalled();
    expect(d.envoyer).not.toHaveBeenCalled();
  });

  it('forcerFenetre (test uniquement) : déclenche même un lundi', async () => {
    await scheduler(LUNDI_8H01, [contratRow()], d, {
      ...OPTIONS,
      forcerFenetre: true,
    }).declencher();

    expect(d.notifier).toHaveBeenCalledTimes(1);
  });

  it('forcerFenetre : tick immédiat au bootstrap (sans attendre l’intervalle)', async () => {
    const s = scheduler(LUNDI_8H01, [contratRow()], d, {
      ...OPTIONS,
      forcerFenetre: true,
    });
    s.onApplicationBootstrap();
    try {
      // Le tick de boot est asynchrone (fire-and-forget) : on attend son effet.
      await vi.waitFor(() => {
        expect(d.notifier).toHaveBeenCalledTimes(1);
      });
    } finally {
      s.onApplicationShutdown();
    }
  });

  it('second tick le même mardi : notifie (no-op base) mais n’envoie aucun mail', async () => {
    d.notifier
      .mockResolvedValueOnce(true) // 1er tick : ligne créée → mail
      .mockResolvedValue(false); // ticks suivants : conflit → pas de mail
    const s = scheduler(MARDI_8H01, [contratRow()], d);

    await s.declencher();
    await s.declencher();

    expect(d.notifier).toHaveBeenCalledTimes(2);
    expect(d.envoyer).toHaveBeenCalledTimes(1);
  });

  it('résout les préavis distincts (crèche + ABCM) dans le mail groupé du foyer', async () => {
    const dd = doubles(
      [ETAB_CRECHE, ETAB_ABCM],
      [{ parentId: 'p1', email: 'solo@test' }],
    );
    await scheduler(
      MARDI_8H01,
      [
        contratRow({
          id: 'c1',
          mode: 'CRECHE_PSU',
          enfant: 'Léa',
          etablissementId: ETAB_CRECHE_ID,
        }),
        contratRow({
          id: 'c2',
          mode: 'PERISCOLAIRE',
          enfant: 'Tom',
          etablissementId: ETAB_ABCM_ID,
        }),
      ],
      dd,
    ).declencher();

    expect(dd.envoyer).toHaveBeenCalledTimes(1);
    const message = dd.envoyer.mock.calls[0]?.[0] as { text: string };
    expect(message.text).toContain('2 jours ouvrés');
    expect(message.text).toContain('avant jeudi 12:00');
  });

  it('aucun contrat actif : ne consulte pas l’annuaire et n’envoie rien', async () => {
    await scheduler(MARDI_8H01, [], d).declencher();

    expect(d.notifier).not.toHaveBeenCalled();
    expect(d.envoyer).not.toHaveBeenCalled();
  });

  // ---- Volet in-app (PR6) : création au canal IN_APP -----------------------

  it('canal IN_APP actif : crée une entrée d’inbox par parent (VALIDATION_HEBDO)', async () => {
    const dd = doubles(
      [ETAB_CRECHE],
      [{ parentId: 'p1', email: 'solo@test' }],
      'jeton-abc',
      ['p1', 'p2'], // deux parents avec IN_APP actif
    );
    await scheduler(
      MARDI_8H01,
      [contratRow({ enfant: 'Léa' })],
      dd,
    ).declencher();

    expect(dd.destinatairesInApp).toHaveBeenCalledWith(
      FOYER_A,
      'VALIDATION_HEBDO',
    );
    expect(dd.creerInApp).toHaveBeenCalledTimes(2);
    const entree = dd.creerInApp.mock.calls[0]?.[0] as {
      parentId: string;
      type: string;
      sujet: string;
      corps: string;
      lien: string;
    };
    expect(entree.parentId).toBe('p1');
    expect(entree.type).toBe('VALIDATION_HEBDO');
    expect(entree.sujet).toContain(SEMAINE_N1);
    expect(entree.corps).toContain('Léa');
    // Lien profond relatif vers l'éditeur de la semaine du foyer (carte tapable côté web).
    expect(entree.lien).toBe(
      `/foyers/${FOYER_A}/planning?semaine=${SEMAINE_N1}`,
    );
  });

  it('canal IN_APP coupé (aucun destinataire in-app) : ne crée aucune entrée', async () => {
    // `d` par défaut : destinatairesInApp renvoie [] (tous coupés / aucun parent).
    await scheduler(MARDI_8H01, [contratRow()], d).declencher();

    expect(d.creerInApp).not.toHaveBeenCalled();
  });

  it('in-app indépendant de l’e-mail : créé même si l’envoi e-mail retombe sur le repli', async () => {
    // Aucun parent e-mail (→ repli NOTIF_EMAIL_PARENT) mais un parent a l’IN_APP actif.
    const dd = doubles([ETAB_CRECHE], [], 'jeton-abc', ['p1']);
    await scheduler(MARDI_8H01, [contratRow()], dd).declencher();

    expect(dd.envoyer.mock.calls[0]?.[0]).toMatchObject({ to: 'parent@test' });
    expect(dd.creerInApp).toHaveBeenCalledTimes(1);
    expect(dd.creerInApp.mock.calls[0]?.[0]).toMatchObject({ parentId: 'p1' });
  });

  it('échec de création in-app : journalisé sans interrompre l’envoi e-mail', async () => {
    const dd = doubles(
      [ETAB_CRECHE],
      [{ parentId: 'p1', email: 'solo@test' }],
      'jeton-abc',
      ['p1'],
    );
    dd.creerInApp.mockRejectedValue(new Error('base indisponible'));
    await scheduler(MARDI_8H01, [contratRow()], dd).declencher();

    // Dégradation propre : l’e-mail part quand même.
    expect(dd.envoyer).toHaveBeenCalledTimes(1);
  });
});
