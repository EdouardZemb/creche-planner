import { beforeEach, describe, expect, it, vi } from 'vitest';
import { libelleSemaineFr } from '@creche-planner/shared-semaine';
import type { MailerService } from '@creche-planner/nest-commons';
import { MAX_ESSAIS_PARENT, SchedulerHebdo } from './scheduler.hebdo.js';
import type { Clock } from './clock.js';
import type { OptionsScheduler } from './scheduler.options.js';
import type {
  EnvoiRecapService,
  LivraisonParent,
} from './envoi-recap.service.js';
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
 * `DestinatairesService`, `DesabonnementClient`, `MailerService` **et
 * `EnvoiRecapService`** sont des doubles, la base ne sert qu'à lister les contrats actifs
 * (le prédicat drizzle n'est pas évalué — la fonction renvoie le jeu fourni).
 *
 * Couvre PR4 « parents du foyer », PR5 « désabonnement RFC 8058 », PR6 « inbox in-app »
 * **et Lot 3 « statut persisté + reprise »** : le double `EnvoiRecapService` est un
 * **journal en mémoire** fidèle (réservation idempotente `A_ENVOYER`, filtre de reprise
 * `A_ENVOYER`/`ECHEC`, compare-and-set `<> ENVOYE`) qui exerce réellement la machine à
 * états `A_ENVOYER → ECHEC → ENVOYE` du découplage création/envoi.
 *
 * Instants de référence (`Europe/Paris` est en CEST = UTC+2 en juin) :
 * - mardi 2026-06-23 08:01 Paris = 2026-06-23T06:01:00Z → fenêtre création + envoi ;
 * - mercredi 2026-06-24 08:01 Paris → fenêtre envoi seule (retry, pas de création) ;
 * - lundi 2026-06-22 08:01 Paris → hors fenêtre (pas mardi) ;
 * - mardi 2026-06-23 07:00 Paris → hors fenêtre (avant l'heure).
 * La semaine N+1 du mardi 2026-06-23 (semaine W26) est **2026-W27**.
 */

const MARDI_8H01 = '2026-06-23T06:01:00.000Z';
const MERCREDI_8H01 = '2026-06-24T06:01:00.000Z';
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

/** Ligne d'état d'envoi telle que tenue par le journal en mémoire du double. */
interface EnvoiRow {
  foyerId: string;
  semaineIso: string;
  statut: 'A_ENVOYER' | 'ENVOYE' | 'DRY_RUN' | 'ECHEC';
  destinataires: string[];
  messageId: string | null;
  erreur: string | null;
}

/** Clé primaire composite `(foyer, semaine)` du journal `envoi_recap_hebdo`. */
function cleEnvoi(foyerId: string, semaineIso: string): string {
  return `${foyerId}|${semaineIso}`;
}

/** Ligne du ledger de livraison **par parent** (`envoi_recap_parent`, Lot L1). */
interface EnvoiParentRow {
  foyerId: string;
  semaineIso: string;
  parentId: string;
  statut: 'ENVOYE' | 'DRY_RUN' | 'ECHEC';
  essais: number;
  email: string;
  messageId: string | null;
  erreur: string | null;
}

/** Clé primaire composite `(foyer, semaine, parent)` du ledger `envoi_recap_parent`. */
function cleParent(
  foyerId: string,
  semaineIso: string,
  parentId: string,
): string {
  return `${foyerId}|${semaineIso}|${parentId}`;
}

/**
 * Double **fidèle** de `EnvoiRecapService` : un journal en mémoire qui reproduit la
 * clé primaire `(foyer, semaine)`, la réservation idempotente, le filtre de reprise et
 * les transitions compare-and-set `<> ENVOYE`. Les tests inspectent `rows` (état
 * persisté) plutôt que la seule séquence d'appels.
 */
function fakeEnvoiRecap(): {
  service: EnvoiRecapService;
  rows: Map<string, EnvoiRow>;
  parentRows: Map<string, EnvoiParentRow>;
  reserver: ReturnType<typeof vi.fn>;
  aRetenter: ReturnType<typeof vi.fn>;
  marquerAbouti: ReturnType<typeof vi.fn>;
  marquerEchec: ReturnType<typeof vi.fn>;
  livraisonsParFoyerSemaine: ReturnType<typeof vi.fn>;
  marquerParentAbouti: ReturnType<typeof vi.fn>;
  marquerParentEchec: ReturnType<typeof vi.fn>;
} {
  const rows = new Map<string, EnvoiRow>();
  const parentRows = new Map<string, EnvoiParentRow>();
  const reserver = vi.fn((foyerId: string, semaineIso: string) => {
    const cle = cleEnvoi(foyerId, semaineIso);
    if (!rows.has(cle)) {
      rows.set(cle, {
        foyerId,
        semaineIso,
        statut: 'A_ENVOYER',
        destinataires: [],
        messageId: null,
        erreur: null,
      });
    }
    return Promise.resolve();
  });
  const aRetenter = vi.fn((semaineIso: string) =>
    Promise.resolve(
      [...rows.values()].filter(
        (r) =>
          r.semaineIso === semaineIso &&
          (r.statut === 'A_ENVOYER' || r.statut === 'ECHEC'),
      ),
    ),
  );
  const marquerAbouti = vi.fn(
    (
      foyerId: string,
      semaineIso: string,
      issue: {
        statut: 'ENVOYE' | 'DRY_RUN';
        messageId: string | null;
        destinataires: readonly string[];
      },
    ) => {
      const r = rows.get(cleEnvoi(foyerId, semaineIso));
      if (r && r.statut !== 'ENVOYE') {
        r.statut = issue.statut;
        r.messageId = issue.messageId;
        r.destinataires = [...issue.destinataires];
        r.erreur = null;
      }
      return Promise.resolve();
    },
  );
  const marquerEchec = vi.fn(
    (foyerId: string, semaineIso: string, erreur: string) => {
      const r = rows.get(cleEnvoi(foyerId, semaineIso));
      if (r && r.statut !== 'ENVOYE') {
        r.statut = 'ECHEC';
        r.erreur = erreur;
      }
      return Promise.resolve();
    },
  );
  // --- Ledger par parent (Lot L1) : fidèle au compare-and-set + incrément d'essais. ---
  const livraisonsParFoyerSemaine = vi.fn(
    (foyerId: string, semaineIso: string) =>
      Promise.resolve(
        new Map<string, LivraisonParent>(
          [...parentRows.values()]
            .filter((r) => r.foyerId === foyerId && r.semaineIso === semaineIso)
            .map((r) => [r.parentId, { statut: r.statut, essais: r.essais }]),
        ),
      ),
  );
  const marquerParentAbouti = vi.fn(
    (
      foyerId: string,
      semaineIso: string,
      parentId: string,
      params: {
        statut: 'ENVOYE' | 'DRY_RUN';
        email: string;
        messageId: string | null;
      },
    ) => {
      const cle = cleParent(foyerId, semaineIso, parentId);
      const r = parentRows.get(cle);
      // Compare-and-set : un parent déjà terminal n'est jamais rétrogradé/relivré.
      if (r && (r.statut === 'ENVOYE' || r.statut === 'DRY_RUN')) {
        return Promise.resolve();
      }
      parentRows.set(cle, {
        foyerId,
        semaineIso,
        parentId,
        statut: params.statut,
        essais: r?.essais ?? 0,
        email: params.email,
        messageId: params.messageId,
        erreur: null,
      });
      return Promise.resolve();
    },
  );
  const marquerParentEchec = vi.fn(
    (
      foyerId: string,
      semaineIso: string,
      parentId: string,
      params: { email: string; erreur: string },
    ) => {
      const cle = cleParent(foyerId, semaineIso, parentId);
      const r = parentRows.get(cle);
      // Compare-and-set : un ECHEC n'écrase jamais un envoi déjà abouti.
      if (r && (r.statut === 'ENVOYE' || r.statut === 'DRY_RUN')) {
        return Promise.resolve();
      }
      parentRows.set(cle, {
        foyerId,
        semaineIso,
        parentId,
        statut: 'ECHEC',
        essais: (r?.essais ?? 0) + 1,
        email: params.email,
        messageId: r?.messageId ?? null,
        erreur: params.erreur,
      });
      return Promise.resolve();
    },
  );
  return {
    service: {
      reserver,
      aRetenter,
      marquerAbouti,
      marquerEchec,
      livraisonsParFoyerSemaine,
      marquerParentAbouti,
      marquerParentEchec,
    } as unknown as EnvoiRecapService,
    rows,
    parentRows,
    reserver,
    aRetenter,
    marquerAbouti,
    marquerEchec,
    livraisonsParFoyerSemaine,
    marquerParentAbouti,
    marquerParentEchec,
  };
}

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
  envoiRecap: EnvoiRecapService;
  envoiRows: Map<string, EnvoiRow>;
  envoiParentRows: Map<string, EnvoiParentRow>;
  reserver: ReturnType<typeof vi.fn>;
  aRetenter: ReturnType<typeof vi.fn>;
  marquerAbouti: ReturnType<typeof vi.fn>;
  marquerEchec: ReturnType<typeof vi.fn>;
  livraisonsParFoyerSemaine: ReturnType<typeof vi.fn>;
  marquerParentAbouti: ReturnType<typeof vi.fn>;
  marquerParentEchec: ReturnType<typeof vi.fn>;
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
  const recap = fakeEnvoiRecap();
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
    envoiRecap: recap.service,
    envoiRows: recap.rows,
    envoiParentRows: recap.parentRows,
    reserver: recap.reserver,
    aRetenter: recap.aRetenter,
    marquerAbouti: recap.marquerAbouti,
    marquerEchec: recap.marquerEchec,
    livraisonsParFoyerSemaine: recap.livraisonsParFoyerSemaine,
    marquerParentAbouti: recap.marquerParentAbouti,
    marquerParentEchec: recap.marquerParentEchec,
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
    d.envoiRecap,
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
    // Sujet humanisé (Lot 4) : plus de numéro de semaine ISO, un libellé parent.
    expect(message.subject).toBe(
      `Valider le planning — ${libelleSemaineFr(SEMAINE_N1)}`,
    );
    expect(message.subject).not.toMatch(/\d{4}-W\d{2}/);
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
    expect(d.aRetenter).toHaveBeenCalledTimes(1);
    expect(d.envoiRows.size).toBe(0);
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
    // Sujet humanisé (Lot 4) : le libellé parent, plus le numéro de semaine ISO.
    expect(entree.sujet).toContain(libelleSemaineFr(SEMAINE_N1));
    expect(entree.sujet).not.toMatch(/\d{4}-W\d{2}/);
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

  // ---- Lot 3 : statut persisté + reprise -----------------------------------

  it('échec SMTP au 1er tick puis succès au 2e : A_ENVOYER → ECHEC → ENVOYE, 1 mail, 1 in-app', async () => {
    const dd = doubles(
      [ETAB_CRECHE],
      [{ parentId: 'p1', email: 'solo@test' }],
      'jeton-abc',
      ['p1'],
    );
    dd.envoyer
      .mockRejectedValueOnce(new Error('SMTP indisponible'))
      .mockResolvedValue({ messageId: '<m1@test>', dryRun: false });
    const s = scheduler(MARDI_8H01, [contratRow()], dd);

    // 1er tick : création (slot A_ENVOYER) + envoi qui échoue → ECHEC, pas d'in-app.
    await s.declencher();
    expect(dd.envoiRows.get(cleEnvoi(FOYER_A, SEMAINE_N1))?.statut).toBe(
      'ECHEC',
    );
    expect(dd.creerInApp).not.toHaveBeenCalled();

    // 2e tick : reprise du slot ECHEC → envoi réussi → ENVOYE, in-app créé une fois.
    await s.declencher();
    const row = dd.envoiRows.get(cleEnvoi(FOYER_A, SEMAINE_N1));
    expect(row?.statut).toBe('ENVOYE');
    expect(row?.messageId).toBe('<m1@test>');
    expect(row?.destinataires).toEqual(['solo@test']);
    expect(dd.creerInApp).toHaveBeenCalledTimes(1);
    // Deux tentatives d'envoi (1 échec + 1 succès), un seul mail réellement parti.
    expect(dd.envoyer).toHaveBeenCalledTimes(2);
  });

  it('dry-run : slot DRY_RUN, aucun renvoi au tick suivant', async () => {
    // Doubles par défaut : `envoyer` renvoie `{ dryRun: true }`.
    const s = scheduler(MARDI_8H01, [contratRow()], d);

    await s.declencher();
    expect(d.envoiRows.get(cleEnvoi(FOYER_A, SEMAINE_N1))?.statut).toBe(
      'DRY_RUN',
    );

    await s.declencher();
    expect(d.envoyer).toHaveBeenCalledTimes(1); // DRY_RUN n'est jamais retenté.
  });

  it('slot ENVOYE : aucun renvoi aux ticks suivants (idempotence)', async () => {
    const dd = doubles();
    dd.envoyer.mockResolvedValue({ messageId: '<m@test>', dryRun: false });
    const s = scheduler(MARDI_8H01, [contratRow()], dd);

    await s.declencher();
    expect(dd.envoiRows.get(cleEnvoi(FOYER_A, SEMAINE_N1))?.statut).toBe(
      'ENVOYE',
    );

    await s.declencher();
    await s.declencher();
    expect(dd.envoyer).toHaveBeenCalledTimes(1);
  });

  it('reprise un jour ultérieur (mercredi) : hors création mais l’envoi rejoue l’ECHEC', async () => {
    const dd = doubles(
      [ETAB_CRECHE],
      [{ parentId: 'p1', email: 'solo@test' }],
      'jeton-abc',
      ['p1'],
    );
    dd.envoyer
      .mockRejectedValueOnce(new Error('SMTP down'))
      .mockResolvedValue({ messageId: '<m@test>', dryRun: false });

    // Mardi : création + échec d'envoi.
    await scheduler(MARDI_8H01, [contratRow()], dd).declencher();
    expect(dd.envoiRows.get(cleEnvoi(FOYER_A, SEMAINE_N1))?.statut).toBe(
      'ECHEC',
    );

    // Mercredi (nouvelle instance, journal partagé) : fenêtre envoi mais pas création.
    dd.notifier.mockClear();
    await scheduler(MERCREDI_8H01, [contratRow()], dd).declencher();

    expect(dd.notifier).not.toHaveBeenCalled(); // phase création NON rejouée hors mardi
    expect(dd.envoiRows.get(cleEnvoi(FOYER_A, SEMAINE_N1))?.statut).toBe(
      'ENVOYE',
    );
  });

  it('tick hors fenêtre (lundi) : aucune tentative même avec un slot ECHEC en attente', async () => {
    const dd = doubles();
    dd.envoiRows.set(cleEnvoi(FOYER_A, SEMAINE_N1), {
      foyerId: FOYER_A,
      semaineIso: SEMAINE_N1,
      statut: 'ECHEC',
      destinataires: [],
      messageId: null,
      erreur: 'précédent',
    });

    await scheduler(LUNDI_8H01, [contratRow()], dd).declencher();

    expect(dd.aRetenter).not.toHaveBeenCalled();
    expect(dd.envoyer).not.toHaveBeenCalled();
  });

  it('foyer sans enfant concerné (contrat supprimé entre-temps) : slot ENVOYE sans mail', async () => {
    const dd = doubles();
    // Slot réservé mais plus aucun contrat actif à l'envoi (reconstruction vide).
    dd.envoiRows.set(cleEnvoi(FOYER_A, SEMAINE_N1), {
      foyerId: FOYER_A,
      semaineIso: SEMAINE_N1,
      statut: 'A_ENVOYER',
      destinataires: [],
      messageId: null,
      erreur: null,
    });

    await scheduler(MARDI_8H01, [], dd).declencher();

    expect(dd.envoyer).not.toHaveBeenCalled();
    expect(dd.creerInApp).not.toHaveBeenCalled();
    expect(dd.envoiRows.get(cleEnvoi(FOYER_A, SEMAINE_N1))?.statut).toBe(
      'ENVOYE',
    );
  });

  it('un foyer en échec n’empêche pas l’envoi des autres foyers du tick', async () => {
    const dd = doubles();
    // Foyer A échoue, foyer B réussit (repli des deux, ordre de réservation A puis B).
    dd.envoyer
      .mockRejectedValueOnce(new Error('SMTP A'))
      .mockResolvedValue({ messageId: '<mB@test>', dryRun: false });

    await scheduler(
      MARDI_8H01,
      [
        contratRow({ id: 'c1', foyerId: FOYER_A, enfant: 'Léa' }),
        contratRow({ id: 'c2', foyerId: FOYER_B, enfant: 'Noé' }),
      ],
      dd,
    ).declencher();

    expect(dd.envoyer).toHaveBeenCalledTimes(2);
    expect(dd.envoiRows.get(cleEnvoi(FOYER_A, SEMAINE_N1))?.statut).toBe(
      'ECHEC',
    );
    expect(dd.envoiRows.get(cleEnvoi(FOYER_B, SEMAINE_N1))?.statut).toBe(
      'ENVOYE',
    );
  });

  // ---- Lot L1 : ledger de livraison par parent (anti-tempête + cap) ---------

  /** Nombre d'envois adressés à une adresse donnée sur l'ensemble des ticks. */
  function envoisVers(dd: Doubles, email: string): number {
    return dd.envoyer.mock.calls.filter(
      (c) => (c[0] as { to: string }).to === email,
    ).length;
  }

  it('anti-tempête : un co-parent injoignable ne re-livre JAMAIS le parent principal', async () => {
    const dd = doubles(
      [ETAB_CRECHE],
      [
        { parentId: 'p1', email: 'maman@test' }, // principal, servi une seule fois
        { parentId: 'p2', email: 'papa@test' }, // adresse qui rejette toujours
      ],
      'jeton-abc',
      ['p1'], // un seul destinataire in-app (assertion creerInApp = 1 au solde)
    );
    // p1 (principal, trié en tête) est servi au 1er appel ; p2 rejette à chaque appel suivant.
    dd.envoyer
      .mockResolvedValueOnce({ messageId: '<m1@test>', dryRun: false })
      .mockRejectedValue(new Error('adresse invalide'));
    const s = scheduler(MARDI_8H01, [contratRow()], dd);

    // 3 ticks : le slot foyer rejoue à cause de p2, mais p1 ne doit partir qu'une fois.
    await s.declencher();
    await s.declencher();
    await s.declencher();

    expect(envoisVers(dd, 'maman@test')).toBe(1); // ← cœur du fix : jamais spammé
    expect(envoisVers(dd, 'papa@test')).toBe(3); // seul l'injoignable est retenté
    // Slot foyer en ECHEC (p2 bloque) ; l'in-app n'est PAS créé (foyer non soldé).
    expect(dd.envoiRows.get(cleEnvoi(FOYER_A, SEMAINE_N1))?.statut).toBe(
      'ECHEC',
    );
    expect(dd.creerInApp).not.toHaveBeenCalled();
    // Ledger : p1 terminal ENVOYE (jamais rétrogradé), p2 en ECHEC avec essais qui montent.
    expect(
      dd.envoiParentRows.get(cleParent(FOYER_A, SEMAINE_N1, 'p1'))?.statut,
    ).toBe('ENVOYE');
    const p2 = dd.envoiParentRows.get(cleParent(FOYER_A, SEMAINE_N1, 'p2'));
    expect(p2?.statut).toBe('ECHEC');
    expect(p2?.essais).toBe(3);
    // Jeton émis pour p1 UNE fois (skip-si-livré n'émet plus de jeton ensuite).
    expect(
      dd.emettreJeton.mock.calls.filter(
        (c) => (c[0] as { parentId: string }).parentId === 'p1',
      ),
    ).toHaveLength(1);

    // p2 finit par répondre → le foyer se solde : slot ENVOYE, in-app créé UNE fois,
    // et p1 (déjà livré) n'est toujours pas re-sollicité.
    dd.envoyer.mockResolvedValue({ messageId: '<m2@test>', dryRun: false });
    await s.declencher();
    expect(dd.envoiRows.get(cleEnvoi(FOYER_A, SEMAINE_N1))?.statut).toBe(
      'ENVOYE',
    );
    expect(dd.creerInApp).toHaveBeenCalledTimes(1);
    expect(envoisVers(dd, 'maman@test')).toBe(1);
  });

  it('cap : une adresse définitivement invalide est abandonnée après MAX_ESSAIS_PARENT essais', async () => {
    const dd = doubles(
      [ETAB_CRECHE],
      [
        { parentId: 'p1', email: 'maman@test' },
        { parentId: 'p2', email: 'papa@test' },
      ],
      'jeton-abc',
      ['p1'],
    );
    // p1 servi au 1er appel ; p2 rejette à chaque tick suivant (adresse définitivement invalide).
    dd.envoyer
      .mockResolvedValueOnce({ messageId: '<m@test>', dryRun: false })
      .mockRejectedValue(new Error('adresse invalide'));
    const s = scheduler(MARDI_8H01, [contratRow()], dd);

    // MAX_ESSAIS_PARENT ticks : p2 rejette et incrémente son compteur jusqu'au plafond.
    for (let i = 0; i < MAX_ESSAIS_PARENT; i++) {
      await s.declencher();
    }
    expect(envoisVers(dd, 'papa@test')).toBe(MAX_ESSAIS_PARENT);
    expect(
      dd.envoiParentRows.get(cleParent(FOYER_A, SEMAINE_N1, 'p2'))?.essais,
    ).toBe(MAX_ESSAIS_PARENT);
    // Toujours en échec : p2 bloque encore la terminalisation du slot.
    expect(dd.envoiRows.get(cleEnvoi(FOYER_A, SEMAINE_N1))?.statut).toBe(
      'ECHEC',
    );
    expect(dd.creerInApp).not.toHaveBeenCalled();

    // Tick suivant : p2 a atteint le plafond → abandonné (plus jamais tenté), slot soldé.
    await s.declencher();
    expect(envoisVers(dd, 'papa@test')).toBe(MAX_ESSAIS_PARENT); // pas de tentative de plus
    expect(dd.envoiRows.get(cleEnvoi(FOYER_A, SEMAINE_N1))?.statut).toBe(
      'ENVOYE',
    );
    expect(dd.creerInApp).toHaveBeenCalledTimes(1);
    // p1 livré une seule fois sur toute la durée (jamais victime du retry de p2).
    expect(envoisVers(dd, 'maman@test')).toBe(1);
  });
});
