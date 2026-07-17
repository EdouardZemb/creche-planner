import { BadRequestException, NotFoundException } from '@nestjs/common';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Column, getTableColumns, Param, type Table } from 'drizzle-orm';
import { EnvoiService } from './envoi.service.js';
import type { EtablissementProjeteService } from '../etablissement/etablissement-projete.service.js';
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
import { horlogeSysteme, type Clock } from '../scheduler/clock.js';
import type { DeltaModifs } from '../validation/validation.diff.js';

/**
 * Tests du service d'envoi **agrégé par établissement** sans Postgres : base factice
 * multi-tables qui honore le sous-ensemble utilisé — `select().from(table).where(and(eq…))`,
 * `insert(table).values().onConflictDoNothing(target[]).returning()` (réservation
 * idempotente du slot), `update(table).set().where(eq…)`. Le mailer et la fiche
 * établissement projetée sont mockés : **aucun** SMTP réel n'est jamais ouvert
 * (dry-run/échec simulés).
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
// Établissement réel destinataire (read model `etablissement`, entité libre par foyer).
const ETAB_ID = '99999999-9999-4999-8999-999999999999';
// Un autre établissement du foyer, pour vérifier le routage par lien explicite.
const ETAB_AUTRE_ID = '99999999-9999-4999-8999-999999999998';

/** Forme de fiche établissement projetée utilisée par les tests (e-mail nullable). */
interface EtabFixture {
  id: string;
  foyerId: string;
  nom: string;
  emailService: string | null;
  preavisRegle: { type: 'JOURS_OUVRES'; valeur: number };
  actif: boolean;
}

const ETAB: EtabFixture = {
  id: ETAB_ID,
  foyerId: FOYER_ID,
  nom: 'Crèche Les Hirondelles',
  emailService: 'contact-creche@example.org',
  preavisRegle: { type: 'JOURS_OUVRES', valeur: 2 },
  actif: true,
};

/** Même fiche, mais **sans** adresse de service → récap non routable. */
const ETAB_SANS_EMAIL: EtabFixture = { ...ETAB, emailService: null };

/** Fiche **archivée** (avec e-mail) → non routable, raison `ARCHIVE`. */
const ETAB_ARCHIVE: EtabFixture = { ...ETAB, actif: false };

/**
 * Fiche **archivée ET sans e-mail** → raison `ARCHIVE` (priorité sur `SANS_EMAIL` :
 * une crèche archivée est signalée « archivée » même si elle n'a pas d'e-mail).
 */
const ETAB_ARCHIVE_SANS_EMAIL: EtabFixture = {
  ...ETAB,
  actif: false,
  emailService: null,
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
          ajustements: [],
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
    etablissementId?: string;
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
    etablissementId: options.etablissementId ?? ETAB_ID,
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

function fakeEtablissements(etab: EtabFixture | null = ETAB): {
  service: EtablissementProjeteService;
  mock: ReturnType<typeof vi.fn>;
} {
  // `null` simule une fiche absente (`parId` renvoie `undefined` en prod) ; `!etab`
  // couvre les deux. On évite `undefined` ici : passé explicitement, il réactiverait
  // la valeur par défaut du paramètre.
  const mock = vi.fn(() => Promise.resolve(etab ?? undefined));
  return {
    service: { parId: mock } as unknown as EtablissementProjeteService,
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

/**
 * Construit le service en injectant une horloge (défaut : `horlogeSysteme`). Les cas de
 * **reprise** (âge d'une ligne `EN_COURS` bloquée) passent une horloge figée à un instant
 * précis pour contrôler le franchissement du seuil `DELAI_REPRISE_EN_COURS_MS`.
 */
function creerService(
  db: Database,
  etablissements: EtablissementProjeteService,
  mailer: MailerService,
  clock: Clock = horlogeSysteme,
): EnvoiService {
  return new EnvoiService(db, etablissements, mailer, clock);
}

/** Horloge figée à un instant ISO (contrôle l'âge des lignes `EN_COURS`). */
function clockFige(iso: string): Clock {
  return { maintenant: () => new Date(iso) };
}

/**
 * Seede une ligne `envoi_etablissement` **déjà réservée** pour `(FOYER, SEMAINE, ETAB)`,
 * afin que le prochain `envoyer` tombe sur le chemin de conflit (reprise status-aware).
 * Le `created_at` pilote la distinction « bloquée » vs « en vol » d'une ligne `EN_COURS`.
 */
function seedEnvoi(
  stores: Map<Table, Ligne[]>,
  options: {
    statut: string;
    createdAt?: Date;
    messageId?: string | null;
    erreur?: string | null;
    envoyeLe?: Date | null;
  },
): void {
  stores.get(envoiEtablissement)?.push({
    id: 'envoi-existant',
    foyerId: FOYER_ID,
    semaineIso: SEMAINE,
    etablissementId: ETAB_ID,
    destinataire: 'contact-creche@example.org',
    sujet: 'Sujet figé',
    corps: '<p>corps figé</p>',
    statut: options.statut,
    messageId: options.messageId ?? null,
    erreur: options.erreur ?? null,
    envoyeLe: options.envoyeLe ?? null,
    createdAt: options.createdAt ?? new Date('2026-06-23T06:00:00.000Z'),
  });
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
    const service = creerService(db, etablissements, mailer);

    const brouillon = await service.brouillon(FOYER_ID, SEMAINE, ETAB_ID);

    expect(brouillon.etablissementId).toBe(ETAB_ID);
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
    // Léa : rattachée à l'établissement visé, validée avec modifs → incluse.
    seedContrat(stores, { id: CONTRAT_LEA, enfant: 'Léa' });
    // Tom : même établissement mais seulement VALIDEE (sans modifs) → exclu.
    seedContrat(stores, {
      id: CONTRAT_TOM,
      enfant: 'Tom',
      statut: 'VALIDEE',
      delta: null,
    });
    // Zoé : rattachée à un AUTRE établissement (lien explicite) → exclue.
    seedContrat(stores, {
      id: '55555555-0000-4000-8000-000000000002',
      enfant: 'Zoé',
      etablissementId: ETAB_AUTRE_ID,
    });
    const { service: etablissements } = fakeEtablissements();
    const { mailer } = fakeMailer({ messageId: null, dryRun: true });
    const service = creerService(db, etablissements, mailer);

    const brouillon = await service.brouillon(FOYER_ID, SEMAINE, ETAB_ID);

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
    const service = creerService(db, etablissements, mailer);

    const brouillon = await service.brouillon(FOYER_ID, SEMAINE, ETAB_ID);

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
    const service = creerService(db, etablissements, mailer);

    const brouillon = await service.brouillon(FOYER_ID, SEMAINE, ETAB_ID);

    expect(brouillon.dryRun).toBe(true);
  });

  it('envoi réel possible quand allowlist autorise le destinataire', async () => {
    process.env['NOTIF_EMAIL_DRY_RUN'] = 'false';
    process.env['NOTIF_EMAIL_ALLOWLIST'] = 'contact-creche@example.org';
    const { db, stores } = fakeBase();
    seedContrat(stores, { id: CONTRAT_LEA, enfant: 'Léa' });
    const { service: etablissements } = fakeEtablissements();
    const { mailer } = fakeMailer({ messageId: null, dryRun: true });
    const service = creerService(db, etablissements, mailer);

    const brouillon = await service.brouillon(FOYER_ID, SEMAINE, ETAB_ID);

    expect(brouillon.dryRun).toBe(false);
  });

  it('404 si l’établissement destinataire est inconnu', async () => {
    const { db, stores } = fakeBase();
    seedContrat(stores, { id: CONTRAT_LEA, enfant: 'Léa' });
    const { service: etablissements } = fakeEtablissements(null);
    const { mailer } = fakeMailer({ messageId: null, dryRun: true });
    const service = creerService(db, etablissements, mailer);

    await expect(
      service.brouillon(FOYER_ID, SEMAINE, ETAB_ID),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('brouillon NON routable (pas de 404) quand l’établissement du foyer n’a pas d’e-mail', async () => {
    const { db, stores } = fakeBase();
    seedContrat(stores, { id: CONTRAT_LEA, enfant: 'Léa', date: '2026-06-29' });
    // Établissement connu, du bon foyer, mais sans adresse de service.
    const { service: etablissements } = fakeEtablissements(ETAB_SANS_EMAIL);
    const { mailer } = fakeMailer({ messageId: null, dryRun: true });
    const service = creerService(db, etablissements, mailer);

    const brouillon = await service.brouillon(FOYER_ID, SEMAINE, ETAB_ID);

    // Plus de 404 : le brouillon revient, marqué non routable, pour être affiché
    // en avertissement (et non écarté silencieusement).
    expect(brouillon.routable).toBe(false);
    expect(brouillon.raisonNonRoutable).toBe('SANS_EMAIL');
    expect(brouillon.destinataire).toBe('');
    // Le calcul des enfants ne dépend pas de l'e-mail : Léa reste listée.
    expect(brouillon.enfants.map((e) => e.enfant)).toEqual(['Léa']);
    // dryRun neutralisé (pas d'envoi possible).
    expect(brouillon.dryRun).toBe(false);
  });

  it('brouillon NON routable (raison ARCHIVE) quand l’établissement est archivé', async () => {
    const { db, stores } = fakeBase();
    seedContrat(stores, { id: CONTRAT_LEA, enfant: 'Léa', date: '2026-06-29' });
    // Établissement connu, du bon foyer, AVEC e-mail, mais archivé (actif=false).
    const { service: etablissements } = fakeEtablissements(ETAB_ARCHIVE);
    const { mailer } = fakeMailer({ messageId: null, dryRun: true });
    const service = creerService(db, etablissements, mailer);

    const brouillon = await service.brouillon(FOYER_ID, SEMAINE, ETAB_ID);

    expect(brouillon.routable).toBe(false);
    expect(brouillon.raisonNonRoutable).toBe('ARCHIVE');
    // Non routable ⇒ destinataire vide, même si la fiche a une adresse (jamais lu ici).
    expect(brouillon.destinataire).toBe('');
    // Le calcul des enfants ne dépend pas de l'état actif : Léa reste listée.
    expect(brouillon.enfants.map((e) => e.enfant)).toEqual(['Léa']);
    expect(brouillon.dryRun).toBe(false);
  });

  it('priorité ARCHIVE > SANS_EMAIL : archivé ET sans e-mail → raison ARCHIVE', async () => {
    const { db, stores } = fakeBase();
    seedContrat(stores, { id: CONTRAT_LEA, enfant: 'Léa' });
    const { service: etablissements } = fakeEtablissements(
      ETAB_ARCHIVE_SANS_EMAIL,
    );
    const { mailer } = fakeMailer({ messageId: null, dryRun: true });
    const service = creerService(db, etablissements, mailer);

    const brouillon = await service.brouillon(FOYER_ID, SEMAINE, ETAB_ID);

    expect(brouillon.routable).toBe(false);
    // Archivé prime : on ne signale PAS « SANS_EMAIL » même sans adresse.
    expect(brouillon.raisonNonRoutable).toBe('ARCHIVE');
  });
});

describe('EnvoiService.envoyer (agrégé par établissement)', () => {
  it('dry-run : journalise DRY_RUN sans messageId et appelle le mailer une fois', async () => {
    const { db, stores } = fakeBase();
    seedContrat(stores, { id: CONTRAT_LEA, enfant: 'Léa' });
    const { service: etablissements } = fakeEtablissements();
    const { mailer, mock } = fakeMailer({ messageId: null, dryRun: true });
    const service = creerService(db, etablissements, mailer);

    const resultat = await service.envoyer(FOYER_ID, SEMAINE, ETAB_ID);

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
    const service = creerService(db, etablissements, mailer);

    const resultat = await service.envoyer(FOYER_ID, SEMAINE, ETAB_ID);

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
    const service = creerService(db, etablissements, mailer);

    const premier = await service.envoyer(FOYER_ID, SEMAINE, ETAB_ID);
    const second = await service.envoyer(FOYER_ID, SEMAINE, ETAB_ID);

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
    const service = creerService(db, etablissements, mailer);

    const resultat = await service.envoyer(FOYER_ID, SEMAINE, ETAB_ID);

    expect(mock).toHaveBeenCalledTimes(1);
    expect(resultat.statut).toBe('ECHEC');
    expect(resultat.messageId).toBeNull();
    expect(resultat.erreur).toContain('SMTP 535');
    const ligne = (stores.get(envoiEtablissement) ?? [])[0];
    expect(ligne?.['statut']).toBe('ECHEC');
    expect(ligne?.['erreur']).toContain('SMTP 535');
  });

  it('refuse un envoi NON routable AVANT tout slot ou mailer (crèche sans e-mail)', async () => {
    const { db, stores } = fakeBase();
    seedContrat(stores, { id: CONTRAT_LEA, enfant: 'Léa' });
    const { service: etablissements } = fakeEtablissements(ETAB_SANS_EMAIL);
    const { mailer, mock } = fakeMailer({ messageId: null, dryRun: true });
    const service = creerService(db, etablissements, mailer);

    await expect(
      service.envoyer(FOYER_ID, SEMAINE, ETAB_ID),
    ).rejects.toBeInstanceOf(BadRequestException);

    // Garde métier : aucune réservation de slot, aucune sollicitation du transport.
    expect(mock).not.toHaveBeenCalled();
    expect(stores.get(envoiEtablissement) ?? []).toHaveLength(0);
  });

  it('refuse un envoi vers un établissement ARCHIVÉ AVANT tout slot ou mailer', async () => {
    const { db, stores } = fakeBase();
    seedContrat(stores, { id: CONTRAT_LEA, enfant: 'Léa' });
    const { service: etablissements } = fakeEtablissements(ETAB_ARCHIVE);
    const { mailer, mock } = fakeMailer({ messageId: null, dryRun: true });
    const service = creerService(db, etablissements, mailer);

    await expect(
      service.envoyer(FOYER_ID, SEMAINE, ETAB_ID),
    ).rejects.toBeInstanceOf(BadRequestException);

    // Garde métier : aucune réservation de slot, aucune sollicitation du transport.
    expect(mock).not.toHaveBeenCalled();
    expect(stores.get(envoiEtablissement) ?? []).toHaveLength(0);
  });
});

/**
 * Reprise **status-aware** d'une ligne déjà réservée (GAP A, Lot 5) : à la ré-action du
 * parent, un succès terminal reste idempotent, un échec ou une réservation `EN_COURS`
 * bloquée par un crash est reprise (mailer ré-invoqué), et un envoi réellement en vol
 * (double-clic) n'est pas ré-envoyé. Toutes les branches sont pilotées par une horloge
 * contrôlée qui fait franchir (ou non) le seuil de 2 min.
 */
describe('EnvoiService.envoyer — reprise status-aware (GAP A)', () => {
  it('ENVOYE existant : aucun ré-envoi (idempotent), rend la ligne telle quelle', async () => {
    const { db, stores } = fakeBase();
    seedContrat(stores, { id: CONTRAT_LEA, enfant: 'Léa' });
    seedEnvoi(stores, {
      statut: 'ENVOYE',
      messageId: '<deja@test>',
      envoyeLe: new Date('2026-06-23T06:00:05.000Z'),
    });
    const { service: etablissements } = fakeEtablissements();
    const { mailer, mock } = fakeMailer({
      messageId: '<neuf@test>',
      dryRun: false,
    });
    const service = creerService(db, etablissements, mailer);

    const resultat = await service.envoyer(FOYER_ID, SEMAINE, ETAB_ID);

    // Le mailer n'est jamais sollicité : la crèche n'est pas re-spammée.
    expect(mock).not.toHaveBeenCalled();
    expect(resultat.statut).toBe('ENVOYE');
    expect(resultat.messageId).toBe('<deja@test>');
    expect(stores.get(envoiEtablissement) ?? []).toHaveLength(1);
  });

  it('ECHEC existant : reprend (mailer ré-appelé) et finalise ENVOYE, motif effacé', async () => {
    const { db, stores } = fakeBase();
    seedContrat(stores, { id: CONTRAT_LEA, enfant: 'Léa' });
    seedEnvoi(stores, {
      statut: 'ECHEC',
      erreur: 'SMTP timeout au premier essai',
      envoyeLe: new Date('2026-06-23T06:00:01.000Z'),
    });
    const { service: etablissements } = fakeEtablissements();
    const { mailer, mock } = fakeMailer({
      messageId: '<repris@test>',
      dryRun: false,
    });
    const service = creerService(db, etablissements, mailer);

    const resultat = await service.envoyer(FOYER_ID, SEMAINE, ETAB_ID);

    expect(mock).toHaveBeenCalledTimes(1);
    expect(resultat.statut).toBe('ENVOYE');
    expect(resultat.messageId).toBe('<repris@test>');
    const ligne = (stores.get(envoiEtablissement) ?? [])[0];
    expect(ligne?.['statut']).toBe('ENVOYE');
    // La reprise efface le motif d'échec précédent (nouvelle tentative propre).
    expect(ligne?.['erreur']).toBeNull();
    // Fidélité d'audit : la reprise régénère le brouillon et persiste ce qui est
    // RÉELLEMENT ré-envoyé — plus les valeurs figées au premier essai. La ligne prouve
    // ce que le mailer a reçu.
    expect(ligne?.['sujet']).not.toBe('Sujet figé');
    expect(ligne?.['corps']).not.toBe('<p>corps figé</p>');
    expect(mock).toHaveBeenCalledWith(
      expect.objectContaining({
        subject: ligne?.['sujet'],
        html: ligne?.['corps'],
      }),
    );
    // Reprise **sur place** : pas de doublon de ligne.
    expect(stores.get(envoiEtablissement) ?? []).toHaveLength(1);
  });

  it('EN_COURS bloquée (âge ≥ 2 min) : reprise (crash présumé)', async () => {
    const { db, stores } = fakeBase();
    seedContrat(stores, { id: CONTRAT_LEA, enfant: 'Léa' });
    seedEnvoi(stores, {
      statut: 'EN_COURS',
      createdAt: new Date('2026-06-23T06:00:00.000Z'),
    });
    const { service: etablissements } = fakeEtablissements();
    const { mailer, mock } = fakeMailer({
      messageId: '<debloque@test>',
      dryRun: false,
    });
    // 3 min plus tard : au-delà du seuil de 2 min → ligne considérée bloquée.
    const service = creerService(
      db,
      etablissements,
      mailer,
      clockFige('2026-06-23T06:03:00.000Z'),
    );

    const resultat = await service.envoyer(FOYER_ID, SEMAINE, ETAB_ID);

    expect(mock).toHaveBeenCalledTimes(1);
    expect(resultat.statut).toBe('ENVOYE');
    expect(resultat.messageId).toBe('<debloque@test>');
    expect((stores.get(envoiEtablissement) ?? [])[0]?.['statut']).toBe(
      'ENVOYE',
    );
  });

  it('EN_COURS récente (âge < 2 min) : pas de ré-envoi (envoi réellement en vol)', async () => {
    const { db, stores } = fakeBase();
    seedContrat(stores, { id: CONTRAT_LEA, enfant: 'Léa' });
    seedEnvoi(stores, {
      statut: 'EN_COURS',
      createdAt: new Date('2026-06-23T06:00:00.000Z'),
    });
    const { service: etablissements } = fakeEtablissements();
    const { mailer, mock } = fakeMailer({
      messageId: '<neuf@test>',
      dryRun: false,
    });
    // 30 s plus tard : sous le seuil → double-clic, l'envoi initial est encore en vol.
    const service = creerService(
      db,
      etablissements,
      mailer,
      clockFige('2026-06-23T06:00:30.000Z'),
    );

    const resultat = await service.envoyer(FOYER_ID, SEMAINE, ETAB_ID);

    expect(mock).not.toHaveBeenCalled();
    // Retour honnête « en cours » : jamais présenté comme un succès.
    expect(resultat.statut).toBe('EN_COURS');
    expect((stores.get(envoiEtablissement) ?? [])[0]?.['statut']).toBe(
      'EN_COURS',
    );
  });
});
