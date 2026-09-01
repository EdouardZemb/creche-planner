import { Inject, Injectable } from '@nestjs/common';
import { asc, eq } from 'drizzle-orm';
import { DRIZZLE } from '@creche-planner/nest-commons';
import type { Database } from '../database/database.types.js';
import { engagementUa, journalAudit, sessionUa } from '../database/schema.js';

/** Un engagement de bénévolat déclaré par le foyer (`engagement_ua`). */
export interface ExportEngagementUa {
  readonly debut: string;
  readonly fin: string;
  readonly quotaHeures: number;
  readonly valeurUaCentimes: number;
  readonly cautionCentimes: number | null;
  readonly declareLe: string;
  readonly sessions: readonly ExportSessionUa[];
}

/** Une session de bénévolat saisie par le foyer (`session_ua`). */
export interface ExportSessionUa {
  readonly date: string;
  readonly dureeHeures: number;
  readonly type: string;
  readonly realisePar: string | null;
  readonly etat: string;
  readonly saisieLe: string;
}

/** Une action consignée à la piste d'audit de ce service (`journal_audit`). */
export interface ExportActionAuditUa {
  readonly action: string;
  readonly cibleType: string;
  readonly cibleId: string | null;
  readonly acteurType: string;
  readonly acteur: string | null;
  readonly le: string;
}

/** Part `svc-tarification` de l'export de portabilité d'un foyer. */
export interface ExportUnitesAssociativesVue {
  readonly foyerId: string;
  readonly engagements: readonly ExportEngagementUa[];
  readonly pisteAudit: readonly ExportActionAuditUa[];
}

/**
 * **Part `svc-tarification` de l'export de portabilité** (doc 37 §6).
 *
 * Ce service n'avait jusqu'ici que des **copies** de tables exportées ailleurs — il
 * n'exportait donc rien, et c'était juste : une projection appauvrie livrée en plus
 * de sa source ferait passer pour une donnée de plus ce qui n'est qu'un second
 * exemplaire. La SFD 40 change cela : l'engagement d'unités associatives et ses
 * sessions ne sont projetés de nulle part. Ce sont des **saisies du parent**, et
 * elles n'existent qu'ici — ce qu'un effacement emporte, un export doit le rendre.
 *
 * Les sessions sont **imbriquées** dans leur engagement plutôt que listées à plat :
 * une session hors de sa période ne veut rien dire pour la personne qui lit le
 * fichier, puisque c'est la période qui porte le quota qu'elle sert à solder.
 */
@Injectable()
export class PortabiliteService {
  constructor(@Inject(DRIZZLE) private readonly db: Database) {}

  async exporter(foyerId: string): Promise<ExportUnitesAssociativesVue> {
    const engagements = await this.db
      .select()
      .from(engagementUa)
      .where(eq(engagementUa.foyerId, foyerId))
      .orderBy(asc(engagementUa.debut));
    const sessions = await this.db
      .select()
      .from(sessionUa)
      .where(eq(sessionUa.foyerId, foyerId))
      .orderBy(asc(sessionUa.date));
    const audit = await this.db
      .select()
      .from(journalAudit)
      .where(eq(journalAudit.foyerId, foyerId))
      .orderBy(asc(journalAudit.creeLe));
    return {
      foyerId,
      engagements: engagements.map((e) => ({
        debut: e.debut,
        fin: e.fin,
        quotaHeures: Number(e.quotaHeures),
        valeurUaCentimes: e.valeurUaCentimes,
        cautionCentimes: e.cautionCentimes,
        declareLe: e.creeLe.toISOString(),
        sessions: sessions
          .filter((s) => s.engagementId === e.id)
          .map((s) => ({
            date: s.date,
            dureeHeures: Number(s.dureeHeures),
            type: s.type,
            realisePar: s.realisePar,
            etat: s.etat,
            saisieLe: s.creeLe.toISOString(),
          })),
      })),
      // La piste d'audit sort **sans jamais recopier** la valeur modifiée : elle est
      // déjà rendue par les lignes ci-dessus. Même règle que `svc-foyer`.
      pisteAudit: audit.map((a) => ({
        action: a.action,
        cibleType: a.cibleType,
        cibleId: a.cibleId,
        acteurType: a.acteurType,
        acteur: a.acteur,
        le: a.creeLe.toISOString(),
      })),
    };
  }
}
