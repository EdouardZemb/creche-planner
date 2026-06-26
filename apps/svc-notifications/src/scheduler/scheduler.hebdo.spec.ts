import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { MailerService } from '@creche-planner/nest-commons';
import { SchedulerHebdo } from './scheduler.hebdo.js';
import type { Clock } from './clock.js';
import type { OptionsScheduler } from './scheduler.options.js';
import type { Database } from '../database/database.types.js';
import type { ContratRow } from '../database/schema.js';
import type { ValidationService } from '../validation/validation.service.js';
import type { DestinatairesService } from '../destinataires/destinataires.service.js';
import type {
  EtablissementService,
  EtablissementVue,
} from '../etablissement/etablissement.service.js';

/**
 * Tests du scheduler du mardi avec **horloge mockée** (jamais `new Date()` dans la
 * logique) et sans Postgres ni SMTP : `ValidationService`, `EtablissementService`,
 * `DestinatairesService` et `MailerService` sont des doubles vitest, la base ne sert
 * qu'à lister les contrats actifs (le prédicat drizzle n'est pas évalué — la fonction
 * renvoie le jeu fourni).
 *
 * Couvre la PR4 « parents du foyer » : idempotence figée **par contrat** mais **envoi
 * regroupé par foyer** (un mail par foyer), destinataires = parents actifs résolus
 * (`DestinatairesService`), **repli** sur `NOTIF_EMAIL_PARENT` si le foyer n'en a aucun.
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

function horloge(iso: string): Clock {
  return { maintenant: () => new Date(iso) };
}

const OPTIONS: OptionsScheduler = {
  heureDeclenchement: 8,
  emailParent: 'parent@test',
  appUrl: 'https://app.test',
};

function contratRow(partiel: Partial<ContratRow> = {}): ContratRow {
  return {
    id: '55555555-0000-4000-8000-000000000000',
    foyerId: FOYER_A,
    enfant: 'Léa',
    mode: 'CRECHE_PSU',
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

const ETAB_CRECHE: EtablissementVue = {
  cle: 'CRECHE_HIRONDELLES',
  libelle: 'Crèche Les Hirondelles',
  emailService: 'creche@test',
  preavisRegle: { type: 'JOURS_OUVRES', valeur: 2 },
  actif: true,
};
const ETAB_ABCM: EtablissementVue = {
  cle: 'ABCM',
  libelle: 'École ABCM',
  emailService: 'abcm@test',
  preavisRegle: { type: 'JOUR_HEURE', jour: 'JEUDI', heure: '12:00' },
  actif: true,
};

interface Doubles {
  validation: ValidationService;
  notifier: ReturnType<typeof vi.fn>;
  etablissements: EtablissementService;
  destinataires: DestinatairesService;
  emailsActifs: ReturnType<typeof vi.fn>;
  mailer: MailerService;
  envoyer: ReturnType<typeof vi.fn>;
}

function doubles(
  annuaire: EtablissementVue[] = [ETAB_CRECHE],
  emails: string[] = [],
): Doubles {
  const notifier = vi.fn(() => Promise.resolve(true));
  const emailsActifs = vi.fn(() => Promise.resolve(emails));
  const envoyer = vi.fn(() =>
    Promise.resolve({ messageId: null, dryRun: true }),
  );
  return {
    validation: { notifier } as unknown as ValidationService,
    notifier,
    etablissements: {
      lister: vi.fn(() => Promise.resolve(annuaire)),
    } as unknown as EtablissementService,
    destinataires: {
      emailsActifs,
    } as unknown as DestinatairesService,
    emailsActifs,
    mailer: { envoyer } as unknown as MailerService,
    envoyer,
  };
}

function scheduler(iso: string, contrats: ContratRow[], d: Doubles) {
  return new SchedulerHebdo(
    horloge(iso),
    fakeBase(contrats),
    OPTIONS,
    d.validation,
    d.etablissements,
    d.destinataires,
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

  it('repli : foyer sans parent → mail vers NOTIF_EMAIL_PARENT', async () => {
    await scheduler(MARDI_8H01, [contratRow()], d).declencher();

    expect(d.emailsActifs).toHaveBeenCalledWith(FOYER_A);
    const message = d.envoyer.mock.calls[0]?.[0] as { to: string };
    expect(message.to).toBe('parent@test');
  });

  it('envoie aux parents actifs du foyer (liste SMTP) quand ils existent', async () => {
    const dd = doubles([ETAB_CRECHE], ['maman@test', 'papa@test']);
    await scheduler(MARDI_8H01, [contratRow()], dd).declencher();

    const message = dd.envoyer.mock.calls[0]?.[0] as { to: string };
    expect(message.to).toBe('maman@test, papa@test');
  });

  it('regroupe les contrats d’un même foyer en UN SEUL mail', async () => {
    await scheduler(
      MARDI_8H01,
      [
        contratRow({ id: 'c1', enfant: 'Léa', mode: 'CRECHE_PSU' }),
        contratRow({ id: 'c2', enfant: 'Tom', mode: 'CRECHE_PSU' }),
      ],
      d,
    ).declencher();

    // Idempotence figée PAR CONTRAT (2 appels) mais UN SEUL mail pour le foyer.
    expect(d.notifier).toHaveBeenCalledTimes(2);
    expect(d.envoyer).toHaveBeenCalledTimes(1);
    const message = d.envoyer.mock.calls[0]?.[0] as { text: string };
    expect(message.text).toContain('Léa');
    expect(message.text).toContain('Tom');
  });

  it('foyers distincts : un mail par foyer', async () => {
    await scheduler(
      MARDI_8H01,
      [
        contratRow({ id: 'c1', foyerId: FOYER_A, enfant: 'Léa' }),
        contratRow({ id: 'c2', foyerId: FOYER_B, enfant: 'Noé' }),
      ],
      d,
    ).declencher();

    expect(d.envoyer).toHaveBeenCalledTimes(2);
    expect(d.emailsActifs).toHaveBeenCalledWith(FOYER_A);
    expect(d.emailsActifs).toHaveBeenCalledWith(FOYER_B);
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
    const dd = doubles([ETAB_CRECHE, ETAB_ABCM]);
    await scheduler(
      MARDI_8H01,
      [
        contratRow({ id: 'c1', mode: 'CRECHE_PSU', enfant: 'Léa' }),
        contratRow({ id: 'c2', mode: 'PERISCOLAIRE', enfant: 'Tom' }),
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
});
