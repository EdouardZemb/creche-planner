import { Duree } from '@creche-planner/shared-kernel';
import { jourSemaineDeIso } from './jour-semaine.js';
import { joursDuMois } from './mois.js';
import type { SemaineType } from './semaine-type.js';
import type { PrestationsMoisCreche } from './prestations-mois.types.js';
import {
  DeductionExcessiveError,
  ParametreContratInvalideError,
  PeriodeContratInvalideError,
} from './planification-error.js';

/** Une absence du mois, candidate à déduction PSU (doc 02 §3.2, INV-08). */
export interface AbsenceCreche {
  /**
   * Date ISO `YYYY-MM-DD` du jour retiré (optionnelle). Métadonnée traçant
   * *quel* jour est concerné (affichage, persistance) ; n'entre pas dans le
   * calcul de déduction, qui ne dépend que de la durée et de l'éligibilité.
   */
  readonly date?: string;
  /** Durée d'absence sur les heures réservées. */
  readonly duree: Duree;
  /** Délai de préavis en jours pleins (≥ 2 j ⇒ déductible). */
  readonly preavisJours: number;
  /** Absence pour maladie avec certificat médical (⇒ déductible). */
  readonly certificatMaladie: boolean;
}

/**
 * Un jour de garde ajouté ponctuellement, hors semaine type (« j'ajoute un
 * jour ce mois-ci »). En PSU la mensualité est lissée et constante : un jour
 * supplémentaire est donc un dépassement, facturé à la minute → il s'agrège au
 * complément du mois (doc 02 §3.2).
 */
export interface JourSupplementaireCreche {
  /** Date ISO `YYYY-MM-DD` du jour ajouté. */
  readonly date: string;
  /** Durée de garde ce jour-là. */
  readonly duree: Duree;
}

/** Saisie de génération des prestations crèche d'un mois. */
export interface SaisieGenerationCreche {
  /** Mois ISO `YYYY-MM`. */
  readonly mois: string;
  /** Dépassement horaire du mois, facturé à la minute (doc 02 §3.2). */
  readonly complement?: Duree;
  /** Jours ajoutés ponctuellement (hors semaine type) → agrégés au complément. */
  readonly joursSupplementaires?: readonly JourSupplementaireCreche[];
  /** Absences du mois ; seules les éligibles sont déduites. */
  readonly absences?: readonly AbsenceCreche[];
  /** Jours non facturables (fériés/fermetures) fournis par le Référentiel. */
  readonly joursNonFacturables?: readonly string[];
}

/** Configuration contractuelle d'un contrat crèche PSU (doc 02 §3/§7). */
export interface ConfigContratCreche {
  /** Début de validité ISO `YYYY-MM-DD` (inclus). */
  readonly valideDu: string;
  /** Fin de validité ISO `YYYY-MM-DD` (incluse). */
  readonly valideAu: string;
  /** Heures annuelles contractualisées (doc 02 §7). */
  readonly heuresAnnuellesContractualisees: number;
  /** Nombre de mensualités lissant l'année (ici 7). */
  readonly nbMensualites: number;
  /** Semaine type de garde, pour dériver les heures réservées du mois. */
  readonly semaineType: SemaineType;
}

const FORMAT_ISO_JOUR = /^\d{4}-\d{2}-\d{2}$/;

/** Arrondi à 2 décimales (centième d'heure) — mensualisation, doc 02 §3.1. */
function arrondiCentiemeHeure(heures: number): number {
  return Math.round(heures * 100) / 100;
}

/**
 * Une absence est déductible **uniquement** si elle est prévenue au moins 2
 * jours à l'avance **ou** justifiée par un certificat de maladie (doc 02 §3.2,
 * INV-08). Sinon elle reste facturée (incluse dans la mensualité).
 */
function estDeductible(absence: AbsenceCreche): boolean {
  return absence.preavisJours >= 2 || absence.certificatMaladie;
}

/**
 * Contrat crèche PSU (doc 02 §3/§7) : période de validité, heures annuelles
 * contractualisées lissées sur N mensualités, et semaine type. Génère les
 * « prestations du mois » crèche : heures mensualisées (constantes), complément
 * du mois et heures déduites (absences éligibles). Domaine pur, immuable.
 */
export class ContratCreche {
  private constructor(private readonly config: ConfigContratCreche) {}

  static creer(config: ConfigContratCreche): ContratCreche {
    if (
      !FORMAT_ISO_JOUR.test(config.valideDu) ||
      !FORMAT_ISO_JOUR.test(config.valideAu)
    ) {
      throw new PeriodeContratInvalideError(
        `dates de validité ISO attendues (YYYY-MM-DD) : ${config.valideDu} → ${config.valideAu}`,
      );
    }
    if (config.valideAu < config.valideDu) {
      throw new PeriodeContratInvalideError(
        `fin de validité (${config.valideAu}) antérieure au début (${config.valideDu}) (INV-01)`,
      );
    }
    if (
      !Number.isFinite(config.heuresAnnuellesContractualisees) ||
      config.heuresAnnuellesContractualisees < 0
    ) {
      throw new ParametreContratInvalideError(
        `heures annuelles invalides : ${config.heuresAnnuellesContractualisees} (≥ 0 attendu)`,
      );
    }
    if (!Number.isInteger(config.nbMensualites) || config.nbMensualites < 1) {
      throw new ParametreContratInvalideError(
        `nombre de mensualités invalide : ${config.nbMensualites} (entier ≥ 1 attendu)`,
      );
    }
    return new ContratCreche(config);
  }

  /** Heures mensualisées (constantes) : heuresAnnuelles / nbMensualites (CT-02/03). */
  get heuresMensualisees(): number {
    return arrondiCentiemeHeure(
      this.config.heuresAnnuellesContractualisees / this.config.nbMensualites,
    );
  }

  /** Vrai si la date ISO est dans la période de validité du contrat (inclus). */
  private estDansPeriode(iso: string): boolean {
    return iso >= this.config.valideDu && iso <= this.config.valideAu;
  }

  /**
   * Vrai si au moins un jour du mois `YYYY-MM` est dans la période de validité
   * `[valideDu, valideAu]`. Un mois entièrement hors période ne doit générer
   * aucune prestation facturable (Phase 9, bug #2 : la transition crèche→école).
   */
  couvreMois(mois: string): boolean {
    return joursDuMois(mois).some((iso) => this.estDansPeriode(iso));
  }

  /**
   * Heures réservées du mois = somme de la semaine type sur les jours gardés,
   * facturables (dans la période, hors jours non facturables) (INV-04).
   */
  private heuresReserveesDuMois(
    mois: string,
    joursNonFacturables: ReadonlySet<string>,
  ): Duree {
    return joursDuMois(mois).reduce((total, iso) => {
      if (!this.estDansPeriode(iso) || joursNonFacturables.has(iso)) {
        return total;
      }
      return total.plus(
        this.config.semaineType.dureeJour(jourSemaineDeIso(iso)),
      );
    }, Duree.zero());
  }

  /** Génère les prestations crèche du mois (quantités, pas de montant). */
  genererPrestationsMois(
    saisie: SaisieGenerationCreche,
  ): PrestationsMoisCreche {
    // Mois entièrement hors période : aucune prestation facturable. On neutralise
    // la mensualité lissée (heuresAnnuelles = 0 ⇒ coût PSU nul) et toutes les
    // quantités, plutôt que de facturer une mensualité constante (Phase 9, bug #2).
    if (!this.couvreMois(saisie.mois)) {
      return {
        mode: 'CRECHE_PSU',
        heuresAnnuellesContractualisees: 0,
        nbMensualites: this.config.nbMensualites,
        heuresMensualisees: 0,
        complement: Duree.zero(),
        heuresReservees: Duree.zero(),
        heuresDeduites: Duree.zero(),
      };
    }

    const joursNonFacturables = new Set(saisie.joursNonFacturables ?? []);
    const heuresReservees = this.heuresReserveesDuMois(
      saisie.mois,
      joursNonFacturables,
    );

    const heuresDeduites = (saisie.absences ?? [])
      .filter(estDeductible)
      .reduce((total, absence) => total.plus(absence.duree), Duree.zero());

    if (heuresDeduites.enMinutes > heuresReservees.enMinutes) {
      throw new DeductionExcessiveError(
        `heures déduites (${heuresDeduites.enHeures()}) > heures réservées du mois (${heuresReservees.enHeures()}) (INV-05)`,
      );
    }

    // Les jours ajoutés ponctuellement (dans le mois et la période de validité)
    // sont un dépassement : ils s'agrègent au complément facturé à la minute.
    const prefixeMois = `${saisie.mois}-`;
    const complementJoursSup = (saisie.joursSupplementaires ?? [])
      .filter(
        (j) => j.date.startsWith(prefixeMois) && this.estDansPeriode(j.date),
      )
      .reduce((total, jour) => total.plus(jour.duree), Duree.zero());

    return {
      mode: 'CRECHE_PSU',
      heuresAnnuellesContractualisees:
        this.config.heuresAnnuellesContractualisees,
      nbMensualites: this.config.nbMensualites,
      heuresMensualisees: this.heuresMensualisees,
      complement: (saisie.complement ?? Duree.zero()).plus(complementJoursSup),
      heuresReservees,
      heuresDeduites,
    };
  }
}
