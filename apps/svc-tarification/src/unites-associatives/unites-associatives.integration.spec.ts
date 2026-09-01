import { randomUUID } from 'node:crypto';
import { resolve } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { drizzle } from 'drizzle-orm/postgres-js';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import { eq } from 'drizzle-orm';
import postgres, { type Sql } from 'postgres';
import { FOYER_SUPPRIME_TYPE } from '@creche-planner/contracts-foyer';
import type { Acteur, Clock } from '@creche-planner/nest-commons';
import type { Database } from '../database/database.types.js';
import * as schema from '../database/schema.js';
import { JournalAuditService } from '../audit/journal-audit.service.js';
import { ProjectionService } from '../consumers/projection.service.js';
import { PortabiliteService } from '../portabilite/portabilite.service.js';
import { UnitesAssociativesService } from './unites-associatives.service.js';

/**
 * Test d'**intégration** du suivi des unités associatives (SFD 40), contre une
 * base Postgres **réelle**.
 *
 * Il est écrit contre une vraie base pour une raison précise, apprise à nos frais
 * (`LE-88`) : *un faux `db` ne prouve aucune requête*. Ce qui compte ici — que le
 * `numeric` d'une durée revienne bien en nombre, qu'une session parte avec son
 * engagement par clé étrangère, que l'effacement d'un foyer emporte réellement les
 * trois tables, qu'une ligne d'audit soit écrite **dans la transaction** — est
 * exactement ce qu'un magasin en mémoire honore par construction, donc ne prouve pas.
 *
 * **Bloquant en CI** (le job `ci` fournit `postgres-tarification`), ignoré
 * localement si aucune base n'est joignable : le développeur sans Docker n'est pas
 * pénalisé. Les migrations sont appliquées ici comme au boot du service.
 */

const DATABASE_URL =
  process.env['TARIFICATION_DATABASE_URL'] ??
  'postgres://tarification:tarification@localhost:5436/tarification';
const EN_CI = Boolean(process.env['CI']);
// nx lance vitest avec cwd = racine du projet (apps/svc-tarification).
const MIGRATIONS = resolve(process.cwd(), 'src/database/migrations');

const ACTEUR: Acteur = { type: 'parent', email: 'parent@example.test' };

/** Horloge figée : le tri « réservé » vs « à confirmer » se lit au jour près. */
function horlogeFigee(jour: string): Clock {
  return { maintenant: () => new Date(`${jour}T09:00:00Z`) };
}

async function baseJoignable(): Promise<boolean> {
  const sql = postgres(DATABASE_URL, { max: 1, onnotice: () => undefined });
  try {
    await sql`select 1`;
    return true;
  } catch {
    return false;
  } finally {
    await sql.end({ timeout: 5 });
  }
}

describe('Unités associatives — intégration base réelle (SFD 40)', () => {
  let sql: Sql | undefined;
  let db: Database | undefined;
  let baseOk = false;

  beforeAll(async () => {
    baseOk = await baseJoignable();
    if (!baseOk) {
      if (EN_CI) {
        throw new Error(
          `Postgres injoignable (${DATABASE_URL}) — requis en CI pour l'intégration SFD 40`,
        );
      }
      return;
    }
    sql = postgres(DATABASE_URL, { max: 1, onnotice: () => undefined });
    db = drizzle(sql, { schema });
    await migrate(db, { migrationsFolder: MIGRATIONS });
  }, 60_000);

  afterAll(async () => {
    await sql?.end({ timeout: 5 });
  });

  /** Service câblé sur la base réelle, à un jour de référence donné. */
  function serviceAu(jour: string): UnitesAssociativesService {
    if (db === undefined) {
      throw new Error('base non initialisée');
    }
    return new UnitesAssociativesService(
      db,
      horlogeFigee(jour),
      new JournalAuditService(),
    );
  }

  /** L'engagement de référence de la doc 02 §4.5 : 20 UA à 31,25 €, juin → mai. */
  const ENGAGEMENT = {
    debut: '2026-06-01',
    fin: '2027-05-31',
    quotaHeures: 20,
    valeurUaCentimes: 3125,
    cautionCentimes: 62500,
  };

  it('déclare, saisit, marque réalisé — et les trois compteurs suivent', async (ctx) => {
    if (!baseOk || db === undefined) {
      ctx.skip();
      return;
    }
    const foyerId = randomUUID();
    const ua = serviceAu('2026-10-01');

    // Aucun engagement : l'écran doit pouvoir dire « rien de déclaré », pas
    // afficher trois zéros qui laisseraient croire le foyer à jour.
    const vide = await ua.suivi(foyerId);
    expect(vide.engagement).toBeNull();
    expect(vide.compteurs).toBeNull();

    const engagement = await ua.declarerEngagement(foyerId, ENGAGEMENT, ACTEUR);
    expect(engagement.quotaHeures).toBe(20);
    expect(engagement.cautionCentimes).toBe(62500);

    const session = await ua.ajouterSession(
      foyerId,
      {
        engagementId: engagement.id,
        date: '2026-10-17',
        dureeHeures: 2.5,
        type: 'MENAGE',
        realisePar: 'Camille',
      },
      ACTEUR,
    );
    // Une session naît PREVUE (US-40-02 CA2) : Martha n'a rien réservé, et n'a
    // surtout rien réalisé à la place du parent.
    expect(session.etat).toBe('PREVUE');
    // `numeric` voyage en chaîne côté Drizzle : la vue doit rendre un NOMBRE.
    expect(session.dureeHeures).toBe(2.5);

    const apresReservation = await ua.suivi(foyerId);
    expect(apresReservation.compteurs?.heuresReservees).toBe(2.5);
    expect(apresReservation.compteurs?.heuresRealisees).toBe(0);
    expect(apresReservation.compteurs?.heuresRestantes).toBe(17.5);

    await ua.modifierSession(foyerId, session.id, { etat: 'REALISEE' }, ACTEUR);
    const apresRealisation = await ua.suivi(foyerId);
    // Les heures se DÉPLACENT, sans double comptage (US-40-03 CA1).
    expect(apresRealisation.compteurs?.heuresRealisees).toBe(2.5);
    expect(apresRealisation.compteurs?.heuresReservees).toBe(0);
    expect(apresRealisation.compteurs?.heuresRestantes).toBe(17.5);
    // Le coût est celui du domaine, sur des heures saisies : (20 − 2,5) × 31,25 €.
    expect(apresRealisation.compteurs?.coutSiArret.montantCentimes).toBe(54688);
  });

  it('range une session passée encore PREVUE en « à confirmer » (RM-40-06)', async (ctx) => {
    if (!baseOk || db === undefined) {
      ctx.skip();
      return;
    }
    const foyerId = randomUUID();
    const engagement = await serviceAu('2026-10-01').declarerEngagement(
      foyerId,
      ENGAGEMENT,
      ACTEUR,
    );
    await serviceAu('2026-10-01').ajouterSession(
      foyerId,
      {
        engagementId: engagement.id,
        date: '2026-10-17',
        dureeHeures: 4,
        type: 'GRAND_MENAGE',
      },
      ACTEUR,
    );
    // Le temps passe. Aucune transition automatique : la session reste PREVUE en
    // base, et c'est la LECTURE qui la signale.
    const suivi = await serviceAu('2026-11-01').suivi(foyerId);
    expect(suivi.compteurs?.heuresAConfirmer).toBe(4);
    expect(suivi.compteurs?.heuresRealisees).toBe(0);
    expect(suivi.sessions[0]?.aConfirmer).toBe(true);
    expect(suivi.sessions[0]?.etat).toBe('PREVUE');
  });

  it('refuse une période qui en chevauche une autre (US-40-01 CA2)', async (ctx) => {
    if (!baseOk || db === undefined) {
      ctx.skip();
      return;
    }
    const foyerId = randomUUID();
    const ua = serviceAu('2026-10-01');
    await ua.declarerEngagement(foyerId, ENGAGEMENT, ACTEUR);
    await expect(
      ua.declarerEngagement(
        foyerId,
        { ...ENGAGEMENT, debut: '2027-05-01', fin: '2028-04-30' },
        ACTEUR,
      ),
    ).rejects.toThrow(/couvre déjà/);
    // Une période strictement postérieure, elle, passe.
    await expect(
      ua.declarerEngagement(
        foyerId,
        { ...ENGAGEMENT, debut: '2027-06-01', fin: '2028-05-31' },
        ACTEUR,
      ),
    ).resolves.toMatchObject({ debut: '2027-06-01' });
  });

  it('refuse une session hors de la période, et une session d’un autre foyer', async (ctx) => {
    if (!baseOk || db === undefined) {
      ctx.skip();
      return;
    }
    const foyerId = randomUUID();
    const autreFoyer = randomUUID();
    const ua = serviceAu('2026-10-01');
    const engagement = await ua.declarerEngagement(foyerId, ENGAGEMENT, ACTEUR);
    await expect(
      ua.ajouterSession(
        foyerId,
        {
          engagementId: engagement.id,
          date: '2027-08-01',
          dureeHeures: 2,
          type: 'CANTINE',
        },
        ACTEUR,
      ),
    ).rejects.toThrow(/hors de la période/);
    // La portée foyer ne repose pas que sur le guard : la ressource est bornée.
    await expect(
      ua.ajouterSession(
        autreFoyer,
        {
          engagementId: engagement.id,
          date: '2026-10-17',
          dureeHeures: 2,
          type: 'CANTINE',
        },
        ACTEUR,
      ),
    ).rejects.toThrow(/introuvable/);
  });

  it('écrit une ligne d’audit par mutation, avec son acteur (RM-40-08)', async (ctx) => {
    if (!baseOk || db === undefined) {
      ctx.skip();
      return;
    }
    const base = db;
    const foyerId = randomUUID();
    const ua = serviceAu('2026-10-01');
    const engagement = await ua.declarerEngagement(foyerId, ENGAGEMENT, ACTEUR);
    const session = await ua.ajouterSession(
      foyerId,
      {
        engagementId: engagement.id,
        date: '2026-10-17',
        dureeHeures: 2,
        type: 'CVE',
      },
      ACTEUR,
    );
    await ua.modifierSession(foyerId, session.id, { etat: 'ANNULEE' }, ACTEUR);
    await ua.supprimerSession(foyerId, session.id, ACTEUR);

    const lignes = await base
      .select()
      .from(schema.journalAudit)
      .where(eq(schema.journalAudit.foyerId, foyerId));
    expect(lignes.map((l) => l.action).sort()).toEqual([
      'engagement_ua.declare',
      'session_ua.ajoutee',
      'session_ua.modifiee',
      'session_ua.supprimee',
    ]);
    expect(new Set(lignes.map((l) => l.acteur))).toEqual(
      new Set(['parent@example.test']),
    );
    // La ligne de suppression SURVIT à la suppression de sa cible : aucune clé
    // étrangère ne la rattache à la session.
    const supprimee = lignes.find((l) => l.action === 'session_ua.supprimee');
    expect(supprimee?.cibleId).toBe(session.id);
  });

  it('rend l’engagement et ses sessions à l’export de portabilité (doc 37 §6)', async (ctx) => {
    if (!baseOk || db === undefined) {
      ctx.skip();
      return;
    }
    const base = db;
    const foyerId = randomUUID();
    const ua = serviceAu('2026-10-01');
    const engagement = await ua.declarerEngagement(foyerId, ENGAGEMENT, ACTEUR);
    await ua.ajouterSession(
      foyerId,
      {
        engagementId: engagement.id,
        date: '2026-10-17',
        dureeHeures: 3,
        type: 'TALENT',
        realisePar: 'Camille',
      },
      ACTEUR,
    );
    const document = await new PortabiliteService(base).exporter(foyerId);
    expect(document.engagements).toHaveLength(1);
    expect(document.engagements[0]?.quotaHeures).toBe(20);
    expect(document.engagements[0]?.sessions).toEqual([
      expect.objectContaining({
        date: '2026-10-17',
        dureeHeures: 3,
        type: 'TALENT',
        realisePar: 'Camille',
        etat: 'PREVUE',
      }),
    ]);
    expect(document.pisteAudit.map((a) => a.action)).toEqual([
      'engagement_ua.declare',
      'session_ua.ajoutee',
    ]);
  });

  it('l’effacement du foyer emporte engagement, sessions et piste d’audit', async (ctx) => {
    if (!baseOk || db === undefined) {
      ctx.skip();
      return;
    }
    const base = db;
    const foyerId = randomUUID();
    const ua = serviceAu('2026-10-01');
    const engagement = await ua.declarerEngagement(foyerId, ENGAGEMENT, ACTEUR);
    await ua.ajouterSession(
      foyerId,
      {
        engagementId: engagement.id,
        date: '2026-10-17',
        dureeHeures: 2,
        type: 'MENAGE',
      },
      ACTEUR,
    );

    // Le foyer part par l'événement d'intégration, comme en production.
    const projection = new ProjectionService(base, {
      contratExiste: () => Promise.resolve(false),
    } as never);
    await projection.traiter('FOYER', {
      id: randomUUID(),
      type: FOYER_SUPPRIME_TYPE,
      source: 'svc-foyer',
      version: 1,
      occurredAt: '2027-02-01T00:00:00.000Z',
      traceId: 'trace-suppr-ua',
      payload: { foyerId, parentIds: [] },
    });

    expect(
      await base
        .select()
        .from(schema.engagementUa)
        .where(eq(schema.engagementUa.foyerId, foyerId)),
    ).toEqual([]);
    expect(
      await base
        .select()
        .from(schema.sessionUa)
        .where(eq(schema.sessionUa.foyerId, foyerId)),
    ).toEqual([]);
    expect(
      await base
        .select()
        .from(schema.journalAudit)
        .where(eq(schema.journalAudit.foyerId, foyerId)),
    ).toEqual([]);
  });
});
