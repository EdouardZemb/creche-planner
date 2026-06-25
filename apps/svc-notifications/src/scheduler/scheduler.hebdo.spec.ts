import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { MailerService } from '@creche-planner/nest-commons';
import { SchedulerHebdo } from './scheduler.hebdo.js';
import type { Clock } from './clock.js';
import type { OptionsScheduler } from './scheduler.options.js';
import type { Database } from '../database/database.types.js';
import type { ContratRow } from '../database/schema.js';
import type { ValidationService } from '../validation/validation.service.js';
import type {
  EtablissementService,
  EtablissementVue,
} from '../etablissement/etablissement.service.js';

/**
 * Tests du scheduler du mardi avec **horloge mockée** (jamais `new Date()` dans la
 * logique) et sans Postgres ni SMTP : `ValidationService`, `EtablissementService` et
 * `MailerService` sont des doubles vitest, la base ne sert qu'à lister les contrats
 * actifs (le prédicat drizzle n'est pas évalué — la fonction renvoie le jeu fourni).
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
    foyerId: '22222222-2222-4222-8222-222222222222',
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
  mailer: MailerService;
  envoyer: ReturnType<typeof vi.fn>;
}

function doubles(annuaire: EtablissementVue[] = [ETAB_CRECHE]): Doubles {
  const notifier = vi.fn(() => Promise.resolve(true));
  const envoyer = vi.fn(() =>
    Promise.resolve({ messageId: null, dryRun: true }),
  );
  return {
    validation: { notifier } as unknown as ValidationService,
    notifier,
    etablissements: {
      lister: vi.fn(() => Promise.resolve(annuaire)),
    } as unknown as EtablissementService,
    mailer: { envoyer } as unknown as MailerService,
    envoyer,
  };
}

describe('SchedulerHebdo.declencher', () => {
  let d: Doubles;
  beforeEach(() => {
    d = doubles();
  });

  it('mardi ≥ heure (Paris) : notifie la semaine N+1 et envoie le récap', async () => {
    const scheduler = new SchedulerHebdo(
      horloge(MARDI_8H01),
      fakeBase([contratRow()]),
      OPTIONS,
      d.validation,
      d.etablissements,
      d.mailer,
    );

    await scheduler.declencher();

    expect(d.notifier).toHaveBeenCalledTimes(1);
    expect(d.notifier).toHaveBeenCalledWith({
      contratId: '55555555-0000-4000-8000-000000000000',
      foyerId: '22222222-2222-4222-8222-222222222222',
      semaineIso: SEMAINE_N1,
    });
    expect(d.envoyer).toHaveBeenCalledTimes(1);
    const message = d.envoyer.mock.calls[0]?.[0] as {
      to: string;
      subject: string;
    };
    expect(message.to).toBe('parent@test');
    expect(message.subject).toBe(
      `Valider le planning de la semaine ${SEMAINE_N1}`,
    );
  });

  it('un lundi : ne déclenche rien', async () => {
    const scheduler = new SchedulerHebdo(
      horloge(LUNDI_8H01),
      fakeBase([contratRow()]),
      OPTIONS,
      d.validation,
      d.etablissements,
      d.mailer,
    );

    await scheduler.declencher();

    expect(d.notifier).not.toHaveBeenCalled();
    expect(d.envoyer).not.toHaveBeenCalled();
  });

  it('mardi mais avant l’heure : ne déclenche rien', async () => {
    const scheduler = new SchedulerHebdo(
      horloge(MARDI_7H00),
      fakeBase([contratRow()]),
      OPTIONS,
      d.validation,
      d.etablissements,
      d.mailer,
    );

    await scheduler.declencher();

    expect(d.notifier).not.toHaveBeenCalled();
    expect(d.envoyer).not.toHaveBeenCalled();
  });

  it('second tick le même mardi : notifie (no-op base) mais n’envoie aucun mail', async () => {
    d.notifier
      .mockResolvedValueOnce(true) // 1er tick : ligne créée → mail
      .mockResolvedValue(false); // ticks suivants : conflit → pas de mail
    const scheduler = new SchedulerHebdo(
      horloge(MARDI_8H01),
      fakeBase([contratRow()]),
      OPTIONS,
      d.validation,
      d.etablissements,
      d.mailer,
    );

    await scheduler.declencher();
    await scheduler.declencher();

    expect(d.notifier).toHaveBeenCalledTimes(2);
    expect(d.envoyer).toHaveBeenCalledTimes(1);
  });

  it('résout le préavis selon l’établissement du mode (crèche vs ABCM)', async () => {
    const dd = doubles([ETAB_CRECHE, ETAB_ABCM]);
    const scheduler = new SchedulerHebdo(
      horloge(MARDI_8H01),
      fakeBase([
        contratRow({ id: 'c1', mode: 'CRECHE_PSU', enfant: 'Léa' }),
        contratRow({ id: 'c2', mode: 'PERISCOLAIRE', enfant: 'Tom' }),
      ]),
      OPTIONS,
      dd.validation,
      dd.etablissements,
      dd.mailer,
    );

    await scheduler.declencher();

    expect(dd.envoyer).toHaveBeenCalledTimes(2);
    const textes = dd.envoyer.mock.calls.map(
      (c) => (c[0] as { text: string }).text,
    );
    expect(textes.some((t) => t.includes('2 jours ouvrés'))).toBe(true);
    expect(textes.some((t) => t.includes('avant jeudi 12:00'))).toBe(true);
  });

  it('aucun contrat actif : ne consulte pas l’annuaire et n’envoie rien', async () => {
    const scheduler = new SchedulerHebdo(
      horloge(MARDI_8H01),
      fakeBase([]),
      OPTIONS,
      d.validation,
      d.etablissements,
      d.mailer,
    );

    await scheduler.declencher();

    expect(d.notifier).not.toHaveBeenCalled();
    expect(d.envoyer).not.toHaveBeenCalled();
  });
});
