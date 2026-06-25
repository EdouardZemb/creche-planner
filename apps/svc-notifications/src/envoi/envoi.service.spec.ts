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
import { contrat, envoiMail, notificationHebdo } from '../database/schema.js';
import type { DeltaModifs } from '../validation/validation.diff.js';

/**
 * Tests du service d'envoi **sans Postgres** : base factice multi-tables qui honore le
 * sous-ensemble utilisé — `select().from(table).where(and(eq…))`,
 * `insert(table).values().onConflictDoNothing(target[]).returning()` (réservation
 * idempotente du slot), `update(table).set().where(eq…)`. Le mailer et l'annuaire sont
 * mockés : **aucun** SMTP réel n'est jamais ouvert (dry-run/échec simulés).
 */
type Ligne = Record<string, unknown>;

/** Nom de propriété TS d'une colonne dans sa table (ex. `contrat_id` → `contratId`). */
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
    [envoiMail, []],
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

const CONTRAT_ID = '55555555-0000-4000-8000-000000000000';
const FOYER_ID = '22222222-2222-4222-8222-222222222222';
const SEMAINE = '2026-W27';

const ETAB = {
  cle: 'CRECHE_HIRONDELLES' as const,
  libelle: 'Crèche Les Hirondelles',
  emailService: 'contact-creche@example.org',
  preavisRegle: { type: 'JOURS_OUVRES' as const, valeur: 2 },
  actif: true,
};

const DELTA: DeltaModifs = {
  jours: [
    {
      date: '2026-06-29',
      avant: null,
      apres: {
        joursSupplementaires: [],
        absences: [{ date: '2026-06-29' }],
        exceptions: [],
        joursAlsh: [],
      },
    },
  ],
};

/** Seede un contrat + une semaine notifiée (avec delta) dans la base factice. */
function seed(
  stores: Map<Table, Ligne[]>,
  options: { mode?: string; delta?: DeltaModifs | null } = {},
): void {
  stores.get(contrat)?.push({
    id: CONTRAT_ID,
    foyerId: FOYER_ID,
    enfant: 'Léa',
    mode: options.mode ?? 'CRECHE_PSU',
    valideDu: '2026-01-01',
    valideAu: null,
    updatedAt: new Date(),
  });
  stores.get(notificationHebdo)?.push({
    id: 'n1',
    contratId: CONTRAT_ID,
    foyerId: FOYER_ID,
    semaineIso: SEMAINE,
    type: 'VALIDATION_HEBDO',
    statut: 'VALIDEE_AVEC_MODIFS',
    notifieeLe: new Date(),
    valideeLe: new Date(),
    snapshot: {},
    deltaModifs: options.delta === undefined ? DELTA : options.delta,
    createdAt: new Date(),
    updatedAt: new Date(),
  });
}

function fakeEtablissements(etab = ETAB): {
  service: EtablissementService;
  mock: ReturnType<typeof vi.fn>;
} {
  const mock = vi.fn(() => Promise.resolve(etab));
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

describe('EnvoiService.brouillon', () => {
  beforeEach(() => {
    delete process.env['NOTIF_EMAIL_DRY_RUN'];
    delete process.env['NOTIF_EMAIL_ALLOWLIST'];
  });
  afterEach(() => {
    delete process.env['NOTIF_EMAIL_DRY_RUN'];
    delete process.env['NOTIF_EMAIL_ALLOWLIST'];
  });

  it('résout le destinataire et rend le récap (dry-run actif par défaut)', async () => {
    const { db, stores } = fakeBase();
    seed(stores);
    const { service: etablissements } = fakeEtablissements();
    const { mailer } = fakeMailer({ messageId: null, dryRun: true });
    const service = new EnvoiService(db, etablissements, mailer);

    const brouillon = await service.brouillon(CONTRAT_ID, SEMAINE);

    expect(brouillon.etablissementCle).toBe('CRECHE_HIRONDELLES');
    expect(brouillon.destinataire).toBe('contact-creche@example.org');
    expect(brouillon.sujet).toContain('Léa');
    expect(brouillon.corps).toContain('29/06/2026');
    expect(brouillon.deltaModifs.jours).toHaveLength(1);
    // Pas de NOTIF_EMAIL_DRY_RUN=false → bac à sable actif.
    expect(brouillon.dryRun).toBe(true);
  });

  it('dry-run effectif quand le destinataire est hors allowlist', async () => {
    process.env['NOTIF_EMAIL_DRY_RUN'] = 'false';
    process.env['NOTIF_EMAIL_ALLOWLIST'] = 'autre@example.org';
    const { db, stores } = fakeBase();
    seed(stores);
    const { service: etablissements } = fakeEtablissements();
    const { mailer } = fakeMailer({ messageId: null, dryRun: true });
    const service = new EnvoiService(db, etablissements, mailer);

    const brouillon = await service.brouillon(CONTRAT_ID, SEMAINE);

    expect(brouillon.dryRun).toBe(true);
  });

  it('envoi réel possible quand allowlist autorise le destinataire', async () => {
    process.env['NOTIF_EMAIL_DRY_RUN'] = 'false';
    process.env['NOTIF_EMAIL_ALLOWLIST'] = 'contact-creche@example.org';
    const { db, stores } = fakeBase();
    seed(stores);
    const { service: etablissements } = fakeEtablissements();
    const { mailer } = fakeMailer({ messageId: null, dryRun: true });
    const service = new EnvoiService(db, etablissements, mailer);

    const brouillon = await service.brouillon(CONTRAT_ID, SEMAINE);

    expect(brouillon.dryRun).toBe(false);
  });

  it('404 si le contrat est inconnu', async () => {
    const { db } = fakeBase();
    const { service: etablissements } = fakeEtablissements();
    const { mailer } = fakeMailer({ messageId: null, dryRun: true });
    const service = new EnvoiService(db, etablissements, mailer);

    await expect(service.brouillon(CONTRAT_ID, SEMAINE)).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });

  it('404 si la semaine n’a jamais été notifiée', async () => {
    const { db, stores } = fakeBase();
    stores.get(contrat)?.push({
      id: CONTRAT_ID,
      foyerId: FOYER_ID,
      enfant: 'Léa',
      mode: 'CRECHE_PSU',
      valideDu: '2026-01-01',
      valideAu: null,
      updatedAt: new Date(),
    });
    const { service: etablissements } = fakeEtablissements();
    const { mailer } = fakeMailer({ messageId: null, dryRun: true });
    const service = new EnvoiService(db, etablissements, mailer);

    await expect(service.brouillon(CONTRAT_ID, SEMAINE)).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });
});

describe('EnvoiService.envoyer', () => {
  it('dry-run : journalise DRY_RUN sans messageId et appelle le mailer une fois', async () => {
    const { db, stores } = fakeBase();
    seed(stores);
    const { service: etablissements } = fakeEtablissements();
    const { mailer, mock } = fakeMailer({ messageId: null, dryRun: true });
    const service = new EnvoiService(db, etablissements, mailer);

    const resultat = await service.envoyer(CONTRAT_ID, SEMAINE);

    expect(resultat.statut).toBe('DRY_RUN');
    expect(resultat.messageId).toBeNull();
    expect(resultat.erreur).toBeNull();
    expect(resultat.destinataire).toBe('contact-creche@example.org');
    expect(mock).toHaveBeenCalledTimes(1);
    expect(mock).toHaveBeenCalledWith(
      expect.objectContaining({ to: 'contact-creche@example.org' }),
    );
    const lignes = stores.get(envoiMail) ?? [];
    expect(lignes).toHaveLength(1);
    expect(lignes[0]?.['statut']).toBe('DRY_RUN');
    expect(lignes[0]?.['envoyeLe']).toBeInstanceOf(Date);
    // Le corps figé = ce qui a été passé au mailer (preuve).
    expect(lignes[0]?.['corps']).toContain('29/06/2026');
  });

  it('envoi réel : journalise ENVOYE avec le messageId', async () => {
    const { db, stores } = fakeBase();
    seed(stores);
    const { service: etablissements } = fakeEtablissements();
    const { mailer } = fakeMailer({ messageId: '<msg-1@test>', dryRun: false });
    const service = new EnvoiService(db, etablissements, mailer);

    const resultat = await service.envoyer(CONTRAT_ID, SEMAINE);

    expect(resultat.statut).toBe('ENVOYE');
    expect(resultat.messageId).toBe('<msg-1@test>');
    expect((stores.get(envoiMail) ?? [])[0]?.['statut']).toBe('ENVOYE');
  });

  it('idempotent : un second envoi ne ré-émet rien et renvoie l’existant', async () => {
    const { db, stores } = fakeBase();
    seed(stores);
    const { service: etablissements } = fakeEtablissements();
    const { mailer, mock } = fakeMailer({
      messageId: '<msg-1@test>',
      dryRun: false,
    });
    const service = new EnvoiService(db, etablissements, mailer);

    const premier = await service.envoyer(CONTRAT_ID, SEMAINE);
    const second = await service.envoyer(CONTRAT_ID, SEMAINE);

    expect(mock).toHaveBeenCalledTimes(1);
    expect(second.statut).toBe('ENVOYE');
    expect(second.messageId).toBe(premier.messageId);
    expect(stores.get(envoiMail) ?? []).toHaveLength(1);
  });

  it('échec SMTP : journalise ECHEC avec le motif et ne renvoie pas de messageId', async () => {
    const { db, stores } = fakeBase();
    seed(stores);
    const { service: etablissements } = fakeEtablissements();
    const { mailer, mock } = fakeMailer(new Error('SMTP 535 auth refusée'));
    const service = new EnvoiService(db, etablissements, mailer);

    const resultat = await service.envoyer(CONTRAT_ID, SEMAINE);

    expect(mock).toHaveBeenCalledTimes(1);
    expect(resultat.statut).toBe('ECHEC');
    expect(resultat.messageId).toBeNull();
    expect(resultat.erreur).toContain('SMTP 535');
    const ligne = (stores.get(envoiMail) ?? [])[0];
    expect(ligne?.['statut']).toBe('ECHEC');
    expect(ligne?.['erreur']).toContain('SMTP 535');
  });

  it('envoie même sans modification (delta vide) — récap « aucune modification »', async () => {
    const { db, stores } = fakeBase();
    seed(stores, { delta: { jours: [] } });
    const { service: etablissements } = fakeEtablissements();
    const { mailer } = fakeMailer({ messageId: null, dryRun: true });
    const service = new EnvoiService(db, etablissements, mailer);

    const resultat = await service.envoyer(CONTRAT_ID, SEMAINE);

    expect(resultat.statut).toBe('DRY_RUN');
    expect((stores.get(envoiMail) ?? [])[0]?.['corps']).toContain(
      'Aucune modification',
    );
  });
});
