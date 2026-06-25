import { NotFoundException } from '@nestjs/common';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Column, getTableColumns, Param, type Table } from 'drizzle-orm';
import { EnvoiService } from './envoi.service.js';
import type { EtablissementService } from '../etablissement/etablissement.service.js';
import type {
  MailerService,
  ResultatEnvoi,
} from '@creche-planner/nest-commons';
import type { Database } from '../database/database.types.js';
import {
  contrat,
  envoiEtablissement,
  notificationHebdo,
} from '../database/schema.js';
import type { DeltaModifs } from '../validation/validation.diff.js';

/**
 * Tests du service d'envoi **agrégé par établissement** sans Postgres : base factice
 * multi-tables qui honore le sous-ensemble utilisé — `select().from(table).where(and(eq…))`,
 * `insert(table).values().onConflictDoNothing(target[]).returning()` (réservation
 * idempotente du slot), `update(table).set().where(eq…)`. Le mailer et l'annuaire sont
 * mockés : **aucun** SMTP réel n'est jamais ouvert (dry-run/échec simulés).
 */
type Ligne = Record<string, unknown>;

/** Nom de propriété TS d'une colonne dans sa table (ex. `foyer_id` → `foyerId`). */
function cleDe(table: Table, colonne: Column): string {
  const entree = Object.entries(getTableColumns(table)).find(
    ([, c]) => c === colonne,
  );
  if (!entree) {
    throw new Error(`colonne inconnue : ${colonne.name}`);
  }
  return entree[0];
}

/** Extrait récursivement les égalités `eq(colonne, valeur)` d'un `and(...)`/`eq`. */
function pairesEq(
  condition: unknown,
  table: Table,
): { cle: string; valeur: unknown }[] {
  const paires: { cle: string; valeur: unknown }[] = [];
  const visiter = (noeud: unknown): void => {
    const chunks = (noeud as { queryChunks?: unknown[] }).queryChunks;
    if (!Array.isArray(chunks)) {
      return;
    }
    let colonne: Column | undefined;
    let param: Param | undefined;
    for (const chunk of chunks) {
      if (chunk instanceof Column) {
        colonne = chunk;
      } else if (chunk instanceof Param) {
        param = chunk;
      } else if (
        chunk &&
        typeof chunk === 'object' &&
        Array.isArray((chunk as { queryChunks?: unknown[] }).queryChunks)
      ) {
        visiter(chunk);
      }
    }
    if (colonne && param) {
      paires.push({ cle: cleDe(table, colonne), valeur: param.value });
    }
  };
  visiter(condition);
  return paires;
}

const DEFAUTS_ENVOI: Ligne = {
  messageId: null,
  erreur: null,
  envoyeLe: null,
  createdAt: new Date('2026-06-23T06:00:00.000Z'),
};

function fakeBase(): { db: Database; stores: Map<Table, Ligne[]> } {
  const stores = new Map<Table, Ligne[]>([
    [contrat, []],
    [notificationHebdo, []],
    [envoiEtablissement, []],
  ]);
  const lignesDe = (table: Table): Ligne[] => stores.get(table) ?? [];
  const filtrer = (table: Table, condition: unknown): Ligne[] => {
    const paires = pairesEq(condition, table);
    return lignesDe(table).filter((l) =>
      paires.every((p) => l[p.cle] === p.valeur),
    );
  };
  const db = {
    select: () => ({
      from: (table: Table) => ({
        where: (condition: unknown) =>
          Promise.resolve(filtrer(table, condition)),
      }),
    }),
    insert: (table: Table) => ({
      values: (valeurs: Ligne) => ({
        onConflictDoNothing: (opts: { target: Column | Column[] }) => {
          const cibles = Array.isArray(opts.target)
            ? opts.target
            : [opts.target];
          const cle = (l: Ligne) =>
            cibles.map((c) => l[cleDe(table, c)]).join('|');
          const clef = cle(valeurs);
          const existe = lignesDe(table).some((l) => cle(l) === clef);
          if (!existe) {
            lignesDe(table).push({ ...DEFAUTS_ENVOI, ...valeurs });
          }
          return {
            returning: () =>
              Promise.resolve(existe ? [] : [{ id: valeurs['id'] }]),
          };
        },
      }),
    }),
    update: (table: Table) => ({
      set: (valeurs: Ligne) => ({
        where: (condition: unknown) => {
          for (const l of filtrer(table, condition)) {
            Object.assign(l, valeurs);
          }
          return Promise.resolve();
        },
      }),
    }),
  } as unknown as Database;
  return { db, stores };
}

const FOYER_ID = '22222222-2222-4222-8222-222222222222';
const CONTRAT_LEA = '55555555-0000-4000-8000-000000000000';
const CONTRAT_TOM = '55555555-0000-4000-8000-000000000001';
const SEMAINE = '2026-W27';
const CLE = 'CRECHE_HIRONDELLES' as const;

const ETAB = {
  cle: CLE,
  libelle: 'Crèche Les Hirondelles',
  emailService: 'contact-creche@example.org',
  preavisRegle: { type: 'JOURS_OUVRES' as const, valeur: 2 },
  actif: true,
};

function deltaJour(date: string): DeltaModifs {
  return {
    jours: [
      {
        date,
        avant: null,
        apres: {
          joursSupplementaires: [],
          absences: [{ date }],
          exceptions: [],
          joursAlsh: [],
        },
      },
    ],
  };
}

/** Seede un contrat + sa semaine notifiée (statut/delta paramétrables). */
function seedContrat(
  stores: Map<Table, Ligne[]>,
  options: {
    id: string;
    enfant: string;
    mode?: string;
    statut?: string;
    delta?: DeltaModifs | null;
    date?: string;
  },
): void {
  stores.get(contrat)?.push({
    id: options.id,
    foyerId: FOYER_ID,
    enfant: options.enfant,
    mode: options.mode ?? 'CRECHE_PSU',
    valideDu: '2026-01-01',
    valideAu: null,
    updatedAt: new Date(),
  });
  stores.get(notificationHebdo)?.push({
    id: `n-${options.id}`,
    contratId: options.id,
    foyerId: FOYER_ID,
    semaineIso: SEMAINE,
    type: 'VALIDATION_HEBDO',
    statut: options.statut ?? 'VALIDEE_AVEC_MODIFS',
    notifieeLe: new Date(),
    valideeLe: new Date(),
    snapshot: {},
    deltaModifs:
      options.delta === undefined
        ? deltaJour(options.date ?? '2026-06-29')
        : options.delta,
    createdAt: new Date(),
    updatedAt: new Date(),
  });
}

function fakeEtablissements(etab: typeof ETAB | null = ETAB): {
  service: EtablissementService;
  mock: ReturnType<typeof vi.fn>;
} {
  // `null` simule un établissement absent (`parCle` renvoie `undefined` en prod) ;
  // `!etab` couvre les deux. On évite `undefined` ici : passé explicitement, il
  // réactiverait la valeur par défaut du paramètre.
  const mock = vi.fn(() => Promise.resolve(etab ?? undefined));
  return {
    service: { parCle: mock } as unknown as EtablissementService,
    mock,
  };
}

function fakeMailer(resultat: ResultatEnvoi | Error): {
  mailer: MailerService;
  mock: ReturnType<typeof vi.fn>;
} {
  const mock = vi.fn(() =>
    resultat instanceof Error
      ? Promise.reject(resultat)
      : Promise.resolve(resultat),
  );
  return { mailer: { envoyer: mock } as unknown as MailerService, mock };
}

describe('EnvoiService.brouillon (agrégé par établissement)', () => {
  beforeEach(() => {
    delete process.env['NOTIF_EMAIL_DRY_RUN'];
    delete process.env['NOTIF_EMAIL_ALLOWLIST'];
  });
  afterEach(() => {
    delete process.env['NOTIF_EMAIL_DRY_RUN'];
    delete process.env['NOTIF_EMAIL_ALLOWLIST'];
  });

  it('agrège tous les enfants du foyer concernés (dry-run actif par défaut)', async () => {
    const { db, stores } = fakeBase();
    seedContrat(stores, { id: CONTRAT_LEA, enfant: 'Léa', date: '2026-06-29' });
    seedContrat(stores, { id: CONTRAT_TOM, enfant: 'Tom', date: '2026-07-01' });
    const { service: etablissements } = fakeEtablissements();
    const { mailer } = fakeMailer({ messageId: null, dryRun: true });
    const service = new EnvoiService(db, etablissements, mailer);

    const brouillon = await service.brouillon(FOYER_ID, SEMAINE, CLE);

    expect(brouillon.etablissementCle).toBe(CLE);
    expect(brouillon.destinataire).toBe('contact-creche@example.org');
    expect(brouillon.enfants).toHaveLength(2);
    expect(brouillon.enfants.map((e) => e.enfant)).toEqual(['Léa', 'Tom']);
    expect(brouillon.corps).toContain('Léa');
    expect(brouillon.corps).toContain('Tom');
    expect(brouillon.corps).toContain('29/06/2026');
    expect(brouillon.corps).toContain('01/07/2026');
    expect(brouillon.dryRun).toBe(true);
  });

  it('n’inclut que les contrats VALIDEE_AVEC_MODIFS de l’établissement visé', async () => {
    const { db, stores } = fakeBase();
    // Léa : crèche, validée avec modifs → incluse.
    seedContrat(stores, { id: CONTRAT_LEA, enfant: 'Léa' });
    // Tom : crèche mais seulement VALIDEE (sans modifs) → exclu.
    seedContrat(stores, {
      id: CONTRAT_TOM,
      enfant: 'Tom',
      statut: 'VALIDEE',
      delta: null,
    });
    // Zoé : mode ABCM (autre établissement) → exclue de la crèche.
    seedContrat(stores, {
      id: '55555555-0000-4000-8000-000000000002',
      enfant: 'Zoé',
      mode: 'CANTINE',
    });
    const { service: etablissements } = fakeEtablissements();
    const { mailer } = fakeMailer({ messageId: null, dryRun: true });
    const service = new EnvoiService(db, etablissements, mailer);

    const brouillon = await service.brouillon(FOYER_ID, SEMAINE, CLE);

    expect(brouillon.enfants.map((e) => e.enfant)).toEqual(['Léa']);
  });

  it('rend un récap vide (aucun enfant) sans modification du foyer', async () => {
    const { db, stores } = fakeBase();
    seedContrat(stores, {
      id: CONTRAT_LEA,
      enfant: 'Léa',
      statut: 'VALIDEE',
      delta: null,
    });
    const { service: etablissements } = fakeEtablissements();
    const { mailer } = fakeMailer({ messageId: null, dryRun: true });
    const service = new EnvoiService(db, etablissements, mailer);

    const brouillon = await service.brouillon(FOYER_ID, SEMAINE, CLE);

    expect(brouillon.enfants).toHaveLength(0);
    expect(brouillon.corps).toContain('Aucune modification');
  });

  it('dry-run effectif quand le destinataire est hors allowlist', async () => {
    process.env['NOTIF_EMAIL_DRY_RUN'] = 'false';
    process.env['NOTIF_EMAIL_ALLOWLIST'] = 'autre@example.org';
    const { db, stores } = fakeBase();
    seedContrat(stores, { id: CONTRAT_LEA, enfant: 'Léa' });
    const { service: etablissements } = fakeEtablissements();
    const { mailer } = fakeMailer({ messageId: null, dryRun: true });
    const service = new EnvoiService(db, etablissements, mailer);

    const brouillon = await service.brouillon(FOYER_ID, SEMAINE, CLE);

    expect(brouillon.dryRun).toBe(true);
  });

  it('envoi réel possible quand allowlist autorise le destinataire', async () => {
    process.env['NOTIF_EMAIL_DRY_RUN'] = 'false';
    process.env['NOTIF_EMAIL_ALLOWLIST'] = 'contact-creche@example.org';
    const { db, stores } = fakeBase();
    seedContrat(stores, { id: CONTRAT_LEA, enfant: 'Léa' });
    const { service: etablissements } = fakeEtablissements();
    const { mailer } = fakeMailer({ messageId: null, dryRun: true });
    const service = new EnvoiService(db, etablissements, mailer);

    const brouillon = await service.brouillon(FOYER_ID, SEMAINE, CLE);

    expect(brouillon.dryRun).toBe(false);
  });

  it('404 si l’établissement destinataire est inconnu', async () => {
    const { db, stores } = fakeBase();
    seedContrat(stores, { id: CONTRAT_LEA, enfant: 'Léa' });
    const { service: etablissements } = fakeEtablissements(null);
    const { mailer } = fakeMailer({ messageId: null, dryRun: true });
    const service = new EnvoiService(db, etablissements, mailer);

    await expect(
      service.brouillon(FOYER_ID, SEMAINE, CLE),
    ).rejects.toBeInstanceOf(NotFoundException);
  });
});

describe('EnvoiService.envoyer (agrégé par établissement)', () => {
  it('dry-run : journalise DRY_RUN sans messageId et appelle le mailer une fois', async () => {
    const { db, stores } = fakeBase();
    seedContrat(stores, { id: CONTRAT_LEA, enfant: 'Léa' });
    const { service: etablissements } = fakeEtablissements();
    const { mailer, mock } = fakeMailer({ messageId: null, dryRun: true });
    const service = new EnvoiService(db, etablissements, mailer);

    const resultat = await service.envoyer(FOYER_ID, SEMAINE, CLE);

    expect(resultat.statut).toBe('DRY_RUN');
    expect(resultat.messageId).toBeNull();
    expect(resultat.erreur).toBeNull();
    expect(resultat.destinataire).toBe('contact-creche@example.org');
    expect(mock).toHaveBeenCalledTimes(1);
    expect(mock).toHaveBeenCalledWith(
      expect.objectContaining({ to: 'contact-creche@example.org' }),
    );
    const lignes = stores.get(envoiEtablissement) ?? [];
    expect(lignes).toHaveLength(1);
    expect(lignes[0]?.['statut']).toBe('DRY_RUN');
    expect(lignes[0]?.['envoyeLe']).toBeInstanceOf(Date);
    // Le corps figé = ce qui a été passé au mailer (preuve).
    expect(lignes[0]?.['corps']).toContain('29/06/2026');
  });

  it('envoi réel : journalise ENVOYE avec le messageId', async () => {
    const { db, stores } = fakeBase();
    seedContrat(stores, { id: CONTRAT_LEA, enfant: 'Léa' });
    const { service: etablissements } = fakeEtablissements();
    const { mailer } = fakeMailer({ messageId: '<msg-1@test>', dryRun: false });
    const service = new EnvoiService(db, etablissements, mailer);

    const resultat = await service.envoyer(FOYER_ID, SEMAINE, CLE);

    expect(resultat.statut).toBe('ENVOYE');
    expect(resultat.messageId).toBe('<msg-1@test>');
    expect((stores.get(envoiEtablissement) ?? [])[0]?.['statut']).toBe(
      'ENVOYE',
    );
  });

  it('idempotent : un second envoi ne ré-émet rien et renvoie l’existant', async () => {
    const { db, stores } = fakeBase();
    seedContrat(stores, { id: CONTRAT_LEA, enfant: 'Léa' });
    const { service: etablissements } = fakeEtablissements();
    const { mailer, mock } = fakeMailer({
      messageId: '<msg-1@test>',
      dryRun: false,
    });
    const service = new EnvoiService(db, etablissements, mailer);

    const premier = await service.envoyer(FOYER_ID, SEMAINE, CLE);
    const second = await service.envoyer(FOYER_ID, SEMAINE, CLE);

    expect(mock).toHaveBeenCalledTimes(1);
    expect(second.statut).toBe('ENVOYE');
    expect(second.messageId).toBe(premier.messageId);
    expect(stores.get(envoiEtablissement) ?? []).toHaveLength(1);
  });

  it('échec SMTP : journalise ECHEC avec le motif et ne renvoie pas de messageId', async () => {
    const { db, stores } = fakeBase();
    seedContrat(stores, { id: CONTRAT_LEA, enfant: 'Léa' });
    const { service: etablissements } = fakeEtablissements();
    const { mailer, mock } = fakeMailer(new Error('SMTP 535 auth refusée'));
    const service = new EnvoiService(db, etablissements, mailer);

    const resultat = await service.envoyer(FOYER_ID, SEMAINE, CLE);

    expect(mock).toHaveBeenCalledTimes(1);
    expect(resultat.statut).toBe('ECHEC');
    expect(resultat.messageId).toBeNull();
    expect(resultat.erreur).toContain('SMTP 535');
    const ligne = (stores.get(envoiEtablissement) ?? [])[0];
    expect(ligne?.['statut']).toBe('ECHEC');
    expect(ligne?.['erreur']).toContain('SMTP 535');
  });
});
