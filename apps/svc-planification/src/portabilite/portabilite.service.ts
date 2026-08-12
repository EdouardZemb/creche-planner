import { Inject, Injectable } from '@nestjs/common';
import { asc, eq, inArray } from 'drizzle-orm';
import { DRIZZLE } from '@creche-planner/nest-commons';
import type { Database } from '../database/database.types.js';
import {
  contrat,
  contratVersion,
  correctionJournal,
  etablissement,
  planningMois,
} from '../database/schema.js';

/** Un avenant daté d'un contrat (`contrat_version`). */
export interface ExportAvenant {
  readonly dateEffet: string;
  readonly heuresAnnuellesContractualisees: number | null;
  readonly nbMensualites: number | null;
  readonly semaineType: unknown;
  readonly semaineAbcm: unknown;
  readonly saisiLe: string;
  readonly motif: string | null;
}

/** Une correction rétroactive d'avenant (`correction_journal`). */
export interface ExportCorrectionContrat {
  readonly avant: unknown;
  readonly apres: unknown;
  readonly motif: string | null;
  readonly corrigeLe: string;
}

/** La saisie mensuelle de présences et d'absences (`planning_mois`). */
export interface ExportPlanningMois {
  readonly mois: string;
  readonly simule: boolean;
  readonly saisie: unknown;
  readonly majLe: string;
}

/** Un contrat d'accueil et tout ce qui lui est rattaché. */
export interface ExportContrat {
  readonly id: string;
  readonly enfant: string;
  readonly enfantId: string | null;
  readonly mode: string;
  readonly etablissementId: string;
  readonly valideDu: string;
  readonly valideAu: string | null;
  readonly premiereInscription: boolean;
  readonly heuresAnnuellesContractualisees: number | null;
  readonly nbMensualites: number | null;
  readonly semaineType: unknown;
  readonly semaineAbcm: unknown;
  readonly creeLe: string;
  readonly avenants: readonly ExportAvenant[];
  readonly corrections: readonly ExportCorrectionContrat[];
  readonly plannings: readonly ExportPlanningMois[];
}

/** Un établissement d'accueil déclaré par le foyer (`etablissement`). */
export interface ExportEtablissement {
  readonly id: string;
  readonly nom: string;
  readonly emailService: string | null;
  readonly preavisRegle: unknown;
  readonly types: unknown;
  readonly adresse: string | null;
  readonly telephone: string | null;
  readonly contact: string | null;
  readonly actif: boolean;
  readonly creeLe: string;
}

/** Part `svc-planification` de l'export de portabilité d'un foyer. */
export interface ExportPlanificationVue {
  readonly contrats: readonly ExportContrat[];
  readonly etablissements: readonly ExportEtablissement[];
}

/**
 * **Export de portabilité** de la part `svc-planification` d'un foyer (lot 3 ;
 * `AM-35`). Périmètre : les 5 tables que la cascade d'effacement du lot 2a
 * emporte — `contrat` et, par sa clé, `contrat_version`, `correction_journal`,
 * `planning_mois` ; plus `etablissement`, rattaché au foyer en direct.
 *
 * Trois points qui ne s'improvisent pas :
 *
 * 1. **`etablissement` porte `adresse`, `telephone` et `contact`, qui ne voyagent
 *    dans aucun événement d'intégration.** Le read-model aval de
 *    `svc-notifications` ne les a donc pas : un export bâti sur les copies les
 *    perdrait en silence. Ils se lisent **ici**, à la source, ou nulle part.
 * 2. **Les plannings `simule = true` sont inclus.** Ce sont des saisies du parent,
 *    pas des dérivées du système : les écarter reviendrait à décider à sa place ce
 *    qui, dans ce qu'il a saisi, méritait de lui être rendu.
 * 3. `contrat.enfant` est un **prénom dénormalisé** d'affichage ; `enfantId` est la
 *    référence, encore nullable (promotion NOT NULL différée). Les deux sont
 *    exportés : l'un est lisible, l'autre est la clé de rapprochement avec
 *    l'export `svc-foyer`.
 */
@Injectable()
export class PortabiliteService {
  constructor(@Inject(DRIZZLE) private readonly db: Database) {}

  /**
   * Aucune levée si le foyer est inconnu de ce service : `svc-planification` n'est
   * pas propriétaire du foyer, et un foyer sans contrat est un cas normal (foyer
   * créé, garde pas encore saisie). L'existence du foyer est tranchée en amont,
   * par `svc-foyer`.
   */
  async exporter(foyerId: string): Promise<ExportPlanificationVue> {
    const [contrats, etablissements] = await Promise.all([
      this.db
        .select()
        .from(contrat)
        .where(eq(contrat.foyerId, foyerId))
        .orderBy(asc(contrat.valideDu), asc(contrat.createdAt)),
      this.db
        .select()
        .from(etablissement)
        .where(eq(etablissement.foyerId, foyerId))
        .orderBy(asc(etablissement.nom)),
    ]);

    const contratIds = contrats.map((c) => c.id);
    const [avenants, corrections, plannings] = await Promise.all([
      this.lireAvenants(contratIds),
      this.lireCorrections(contratIds),
      this.lirePlannings(contratIds),
    ]);

    return {
      contrats: contrats.map((c) => ({
        id: c.id,
        enfant: c.enfant,
        enfantId: c.enfantId,
        mode: c.mode,
        etablissementId: c.etablissementId,
        valideDu: c.valideDu,
        valideAu: c.valideAu,
        premiereInscription: c.premiereInscription,
        heuresAnnuellesContractualisees: c.heuresAnnuellesContractualisees,
        nbMensualites: c.nbMensualites,
        semaineType: c.semaineType,
        semaineAbcm: c.semaineAbcm,
        creeLe: c.createdAt.toISOString(),
        avenants: avenants.get(c.id) ?? [],
        corrections: corrections.get(c.id) ?? [],
        plannings: plannings.get(c.id) ?? [],
      })),
      etablissements: etablissements.map((e) => ({
        id: e.id,
        nom: e.nom,
        emailService: e.emailService,
        preavisRegle: e.preavisRegle ?? null,
        types: e.types,
        adresse: e.adresse,
        telephone: e.telephone,
        contact: e.contact,
        actif: e.actif,
        creeLe: e.createdAt.toISOString(),
      })),
    };
  }

  private async lireAvenants(
    contratIds: readonly string[],
  ): Promise<Map<string, ExportAvenant[]>> {
    if (contratIds.length === 0) {
      return new Map();
    }
    const lignes = await this.db
      .select()
      .from(contratVersion)
      .where(inArray(contratVersion.contratId, [...contratIds]))
      .orderBy(asc(contratVersion.dateEffet));
    return grouper(
      lignes,
      (l) => l.contratId,
      (l) => ({
        dateEffet: l.dateEffet,
        heuresAnnuellesContractualisees: l.heuresAnnuellesContractualisees,
        nbMensualites: l.nbMensualites,
        semaineType: l.semaineType,
        semaineAbcm: l.semaineAbcm,
        saisiLe: l.saisiLe.toISOString(),
        motif: l.motif,
      }),
    );
  }

  private async lireCorrections(
    contratIds: readonly string[],
  ): Promise<Map<string, ExportCorrectionContrat[]>> {
    if (contratIds.length === 0) {
      return new Map();
    }
    const lignes = await this.db
      .select()
      .from(correctionJournal)
      .where(inArray(correctionJournal.contratId, [...contratIds]))
      .orderBy(asc(correctionJournal.corrigeLe));
    return grouper(
      lignes,
      (l) => l.contratId,
      (l) => ({
        avant: l.avant,
        apres: l.apres,
        motif: l.motif,
        corrigeLe: l.corrigeLe.toISOString(),
      }),
    );
  }

  private async lirePlannings(
    contratIds: readonly string[],
  ): Promise<Map<string, ExportPlanningMois[]>> {
    if (contratIds.length === 0) {
      return new Map();
    }
    const lignes = await this.db
      .select()
      .from(planningMois)
      .where(inArray(planningMois.contratId, [...contratIds]))
      .orderBy(asc(planningMois.mois), asc(planningMois.simule));
    return grouper(
      lignes,
      (l) => l.contratId,
      (l) => ({
        mois: l.mois,
        simule: l.simule,
        saisie: l.saisie,
        majLe: l.updatedAt.toISOString(),
      }),
    );
  }
}

/** Regroupe des lignes par clé, en projetant chacune. Ordre d'entrée conservé. */
function grouper<TLigne, TVue>(
  lignes: readonly TLigne[],
  cle: (ligne: TLigne) => string,
  projeter: (ligne: TLigne) => TVue,
): Map<string, TVue[]> {
  const parCle = new Map<string, TVue[]>();
  for (const ligne of lignes) {
    const k = cle(ligne);
    const liste = parCle.get(k);
    if (liste) {
      liste.push(projeter(ligne));
    } else {
      parCle.set(k, [projeter(ligne)]);
    }
  }
  return parCle;
}
