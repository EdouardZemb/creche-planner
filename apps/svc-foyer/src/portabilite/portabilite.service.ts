import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import { asc, eq, inArray } from 'drizzle-orm';
import { DRIZZLE } from '@creche-planner/nest-commons';
import type { Database } from '../database/database.types.js';
import {
  correctionJournal,
  desabonnementToken,
  enfant,
  foyer,
  foyerVersion,
  parent,
  preferenceNotification,
} from '../database/schema.js';
import { fusionnerDefauts } from '../foyer/preferences.util.js';

/** Situation financière courante du foyer (`foyer`). */
export interface ExportSituationCourante {
  readonly id: string;
  readonly ressourcesMensuellesCentimes: number;
  readonly rfrCentimes: number;
  readonly nbEnfantsACharge: number;
  readonly nbParts: number;
  readonly creeLe: string;
  readonly majLe: string;
}

/** Une version datée des ressources (`foyer_version`). */
export interface ExportVersionRessources {
  readonly dateEffet: string;
  readonly ressourcesMensuellesCentimes: number;
  readonly rfrCentimes: number;
  readonly nbEnfantsACharge: number;
  readonly nbParts: number;
  readonly saisiLe: string;
  readonly motif: string | null;
}

/** Une correction rétroactive de ressources (`correction_journal`). */
export interface ExportCorrectionRessources {
  readonly avant: unknown;
  readonly apres: unknown;
  readonly motif: string | null;
  readonly corrigeLe: string;
}

export interface ExportEnfant {
  readonly prenom: string;
  readonly dateNaissance: string;
  readonly ajouteLe: string;
}

export interface ExportParent {
  readonly id: string;
  readonly prenom: string | null;
  readonly nom: string | null;
  readonly email: string;
  readonly principal: boolean;
  readonly actif: boolean;
  readonly ajouteLe: string;
  readonly majLe: string;
}

/** Préférence **effective** d'un parent (défaut applicatif + choix stocké). */
export interface ExportPreference {
  readonly parentId: string;
  readonly typeNotification: string;
  readonly canal: string;
  readonly actif: boolean;
  readonly consentementLe: string | null;
  readonly desabonneLe: string | null;
}

/**
 * Trace d'un jeton de désabonnement (`desabonnement_token`), **sans son `jti`** :
 * cf. la note d'en-tête de `PortabiliteService`.
 */
export interface ExportJetonDesabonnement {
  readonly parentId: string;
  readonly typeNotification: string;
  readonly canal: string;
  readonly emisLe: string;
  readonly utiliseLe: string | null;
  readonly expireLe: string;
}

/** Part `svc-foyer` de l'export de portabilité d'un foyer. */
export interface ExportFoyerVue {
  readonly situationCourante: ExportSituationCourante;
  readonly versionsRessources: readonly ExportVersionRessources[];
  readonly correctionsRessources: readonly ExportCorrectionRessources[];
  readonly enfants: readonly ExportEnfant[];
  readonly parents: readonly ExportParent[];
  readonly preferencesNotification: readonly ExportPreference[];
  readonly jetonsDesabonnement: readonly ExportJetonDesabonnement[];
}

/**
 * **Export de portabilité** de la part `svc-foyer` d'un foyer (droit à la
 * portabilité, lot 3 ; `AM-35`). Le périmètre est celui de la cascade
 * d'effacement du lot 2a — ce qu'un effacement emporte, un export doit le
 * rendre — soit les 7 tables rattachées au foyer, directement ou par `parent`.
 *
 * Deux écarts assumés, qui ne s'improvisent pas :
 *
 * 1. **Les préférences sont exportées EFFECTIVES, pas telles qu'en base.** Dans
 *    `preference_notification`, l'absence de ligne **vaut consentement** (défaut
 *    applicatif, doc 37 T3ter) : exporter les seules lignes stockées livrerait
 *    les **écarts au défaut** en les présentant comme l'état complet, c'est-à-dire
 *    une donnée fausse. On réutilise `fusionnerDefauts`, la primitive qui sert
 *    déjà l'écran « Mon profil ».
 * 2. **Le `jti` d'un jeton de désabonnement n'est pas exporté.** Ce jeton est une
 *    capacité : il désabonne sans authentification. Un jeton encore valide
 *    recopié dans un fichier téléchargé, conservé ou transmis, resterait
 *    actionnable par quiconque le lit. La trace (type, canal, dates) suffit à la
 *    finalité de l'export ; le secret, non.
 */
@Injectable()
export class PortabiliteService {
  constructor(@Inject(DRIZZLE) private readonly db: Database) {}

  /** 404 si le foyer n'existe pas — l'export ne fabrique pas de dossier vide. */
  async exporter(foyerId: string): Promise<ExportFoyerVue> {
    const foyers = await this.db
      .select()
      .from(foyer)
      .where(eq(foyer.id, foyerId));
    const ligneFoyer = foyers[0];
    if (!ligneFoyer) {
      throw new NotFoundException(`foyer introuvable : ${foyerId}`);
    }

    // Les parents portent les deux tables de niveau 2 (`preference_notification`,
    // `desabonnement_token`) : ils se lisent avant elles. Les parents **retirés**
    // (soft-delete) sont inclus — leur nom et leur e-mail sont encore là, et
    // l'effacement les emporte : l'export doit les montrer.
    const [versions, corrections, enfants, parents] = await Promise.all([
      this.db
        .select()
        .from(foyerVersion)
        .where(eq(foyerVersion.foyerId, foyerId))
        .orderBy(asc(foyerVersion.dateEffet)),
      this.db
        .select()
        .from(correctionJournal)
        .where(eq(correctionJournal.foyerId, foyerId))
        .orderBy(asc(correctionJournal.creeLe)),
      this.db
        .select()
        .from(enfant)
        .where(eq(enfant.foyerId, foyerId))
        .orderBy(asc(enfant.dateNaissance)),
      this.db
        .select()
        .from(parent)
        .where(eq(parent.foyerId, foyerId))
        .orderBy(asc(parent.ordre), asc(parent.createdAt)),
    ]);

    const parentIds = parents.map((p) => p.id);
    const [preferences, jetons] = await Promise.all([
      this.lirePreferences(parentIds),
      this.lireJetons(parentIds),
    ]);

    return {
      situationCourante: {
        id: ligneFoyer.id,
        ressourcesMensuellesCentimes: ligneFoyer.ressourcesMensuellesCentimes,
        rfrCentimes: ligneFoyer.rfrCentimes,
        nbEnfantsACharge: ligneFoyer.nbEnfantsACharge,
        nbParts: ligneFoyer.nbParts,
        creeLe: ligneFoyer.createdAt.toISOString(),
        majLe: ligneFoyer.updatedAt.toISOString(),
      },
      versionsRessources: versions.map((v) => ({
        dateEffet: v.dateEffet,
        ressourcesMensuellesCentimes: v.ressourcesMensuellesCentimes,
        rfrCentimes: v.rfrCentimes,
        nbEnfantsACharge: v.nbEnfantsACharge,
        nbParts: v.nbParts,
        saisiLe: v.saisiLe.toISOString(),
        motif: v.motif,
      })),
      correctionsRessources: corrections.map((c) => ({
        avant: c.avant,
        apres: c.apres,
        motif: c.motif,
        corrigeLe: c.creeLe.toISOString(),
      })),
      enfants: enfants.map((e) => ({
        prenom: e.prenom,
        dateNaissance: e.dateNaissance,
        ajouteLe: e.createdAt.toISOString(),
      })),
      parents: parents.map((p) => ({
        id: p.id,
        prenom: p.prenom,
        nom: p.nom,
        email: p.email,
        principal: p.principal,
        actif: p.actif,
        ajouteLe: p.createdAt.toISOString(),
        majLe: p.updatedAt.toISOString(),
      })),
      preferencesNotification: preferences,
      jetonsDesabonnement: jetons,
    };
  }

  /**
   * Préférences **effectives** par parent : `fusionnerDefauts` applique le défaut
   * applicatif aux lignes stockées, parent par parent (le défaut n'a de sens que
   * rapporté à un parent).
   */
  private async lirePreferences(
    parentIds: readonly string[],
  ): Promise<ExportPreference[]> {
    if (parentIds.length === 0) {
      return [];
    }
    const lignes = await this.db
      .select()
      .from(preferenceNotification)
      .where(inArray(preferenceNotification.parentId, [...parentIds]));
    return parentIds.flatMap((parentId) =>
      fusionnerDefauts(lignes.filter((l) => l.parentId === parentId)).map(
        (pref) => ({
          parentId,
          typeNotification: pref.typeNotification,
          canal: pref.canal,
          actif: pref.actif,
          consentementLe: pref.consentementAt,
          desabonneLe: pref.desabonneAt,
        }),
      ),
    );
  }

  private async lireJetons(
    parentIds: readonly string[],
  ): Promise<ExportJetonDesabonnement[]> {
    if (parentIds.length === 0) {
      return [];
    }
    const lignes = await this.db
      .select()
      .from(desabonnementToken)
      .where(inArray(desabonnementToken.parentId, [...parentIds]))
      .orderBy(asc(desabonnementToken.emisLe));
    return lignes.map((j) => ({
      parentId: j.parentId,
      typeNotification: j.typeNotification,
      canal: j.canal,
      emisLe: j.emisLe.toISOString(),
      utiliseLe: j.utiliseLe?.toISOString() ?? null,
      expireLe: j.expireLe.toISOString(),
    }));
  }
}
