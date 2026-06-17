import type { Duree } from '@creche-planner/shared-kernel';

/**
 * « Prestations du mois » — quantités produites par le domaine Planification et
 * consommées par le domaine Tarification (doc 02 §3/§4). Le domaine ne calcule
 * AUCUN montant : il produit des quantités alignées sur les types de saisie de
 * `@creche-planner/tarification-domain` (`SaisieMoisPsu`, `SaisieMoisCantine`,
 * `SaisieMoisPeriscolaire`, `SaisieMoisAlsh`).
 *
 * Ce fichier est **purement type** (aucun code exécutable) → exclu du périmètre
 * de couverture (doc 06 §5).
 */

/** Prestations crèche PSU du mois (lissées) — aligné sur `SaisieMoisPsu`. */
export interface PrestationsMoisCreche {
  readonly mode: 'CRECHE_PSU';
  /** Heures annuelles contractualisées (doc 02 §7), pour la mensualisation. */
  readonly heuresAnnuellesContractualisees: number;
  /** Nombre de mensualités lissant l'année (ici 7). */
  readonly nbMensualites: number;
  /** Heures mensualisées = heuresAnnuelles / nbMensualites, arrondi au centième. */
  readonly heuresMensualisees: number;
  /** Dépassement horaire du mois, facturé à la minute (doc 02 §3.2). */
  readonly complement: Duree;
  /** Total des heures réservées du mois (semaine type × jours facturables). */
  readonly heuresReservees: Duree;
  /** Heures déduites du mois (absences éligibles, INV-05 ≤ heuresReservees). */
  readonly heuresDeduites: Duree;
}

/** Prestations cantine ABCM du mois — aligné sur `SaisieMoisCantine`. */
export interface PrestationsMoisCantine {
  readonly mode: 'CANTINE';
  /** Nombre de jours de cantine réservés (réservé = facturé, doc 02 §4.4 bis). */
  readonly nbJours: number;
  /** Cas PAI panier-repas : seule la part « garde » est facturée. */
  readonly pai: boolean;
}

/** Prestations périscolaire ABCM du mois — aligné sur `SaisieMoisPeriscolaire`. */
export interface PrestationsMoisPeriscolaire {
  readonly mode: 'PERISCOLAIRE';
  readonly nbMatins: number;
  readonly nbSoirs: number;
}

/** Prestations ALSH ABCM du mois — aligné sur `SaisieMoisAlsh`. */
export interface PrestationsMoisAlsh {
  readonly mode: 'ALSH';
  readonly nbJourneesCompletes: number;
  readonly nbDemiJournees: number;
  readonly nbRepas: number;
}

/** Union discriminée d'une prestation d'un mode pour un mois. */
export type PrestationMois =
  | PrestationsMoisCreche
  | PrestationsMoisCantine
  | PrestationsMoisPeriscolaire
  | PrestationsMoisAlsh;

/**
 * Agrégat « prestations du mois » d'un enfant, tous modes confondus. C'est la
 * forme exposée à l'app et à la tarification. La crèche et l'ABCM ne coexistent
 * pas pour un même enfant (transition crèche → école, doc 02 §8), mais la forme
 * reste générale.
 */
export interface PlanningMensuel {
  /** Mois ISO `YYYY-MM`. */
  readonly mois: string;
  /** Prestations par mode (au plus une par mode). */
  readonly prestations: readonly PrestationMois[];
}
