import { Duree } from '@creche-planner/shared-kernel';
import { jourSemaineDeIso } from './jour-semaine.js';
import { joursDuMois } from './mois.js';
import type { PlageHoraire } from './plage-horaire.js';
import type { SemaineType } from './semaine-type.js';
import type { PrestationsMoisCreche } from './prestations-mois.types.js';
import {
  AjustementJourNonGardeError,
  DeductionExcessiveError,
  ParametreContratInvalideError,
  PeriodeContratInvalideError,
  SaisieJourEnConflitError,
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

/**
 * Ajustement d'heures **réelles** d'un jour contractualisé : la présence réelle
 * du jour (plage horaire), d'où le domaine dérive l'extension (minutes hors de la
 * plage du contrat → complément) et la réduction (minutes de la plage du contrat
 * non couvertes → déduction si éligible). Éligibilité identique aux absences
 * (préavis suffisant OU certificat). La donnée est datée et restituable telle quelle.
 */
export interface AjustementCreche {
  /** Date ISO `YYYY-MM-DD` du jour ajusté (jour gardé de la semaine type). */
  readonly date: string;
  /** Présence réelle du jour (arrivée/départ), comparée à la plage du contrat. */
  readonly presence: PlageHoraire;
  /** Délai de préavis en jours pleins (≥ 2 j ⇒ réduction déductible). */
  readonly preavisJours: number;
  /** Certificat médical (⇒ réduction déductible). */
  readonly certificatMaladie: boolean;
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
  /** Ajustements d'heures réelles des jours gardés (extension et/ou réduction). */
  readonly ajustements?: readonly AjustementCreche[];
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
 * Une absence (ou la réduction d'un ajustement) est déductible **uniquement** si
 * elle est prévenue au moins 2 jours à l'avance **ou** justifiée par un certificat
 * de maladie (doc 02 §3.2, INV-08). Sinon elle reste facturée (incluse dans la
 * mensualité). Signature structurelle : partagée par les absences et les
 * ajustements (une réduction d'heures est une absence partielle).
 */
function estDeductible(saisie: {
  readonly preavisJours: number;
  readonly certificatMaladie: boolean;
}): boolean {
  return saisie.preavisJours >= 2 || saisie.certificatMaladie;
}

/**
 * Écart d'une présence réelle par rapport à la plage contractuelle d'un jour :
 * - `extension` = minutes présentes **hors** des plages du contrat (avant l'arrivée
 *   et/ou après le départ contractuels) → facturées en complément ;
 * - `reduction` = minutes de la plage du contrat **non couvertes** par la présence
 *   → candidates à déduction.
 * Robuste aux jours à plusieurs plages (chevauchement mesuré plage par plage ; les
 * plages d'un jour de semaine type ne se recouvrent pas entre elles).
 */
function ecartAjustement(
  plagesContrat: readonly PlageHoraire[],
  presence: PlageHoraire,
): { extension: Duree; reduction: Duree } {
  let dureeContrat = 0;
  let chevauchement = 0;
  for (const plage of plagesContrat) {
    dureeContrat += plage.finMinutes - plage.debutMinutes;
    const debut = Math.max(presence.debutMinutes, plage.debutMinutes);
    const fin = Math.min(presence.finMinutes, plage.finMinutes);
    if (fin > debut) {
      chevauchement += fin - debut;
    }
  }
  const dureePresence = presence.finMinutes - presence.debutMinutes;
  return {
    extension: Duree.depuisMinutes(Math.max(0, dureePresence - chevauchement)),
    reduction: Duree.depuisMinutes(Math.max(0, dureeContrat - chevauchement)),
  };
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

    const prefixeMois = `${saisie.mois}-`;

    // Ajustements d'heures réelles : extension (→ complément) et réduction (→
    // déduction si éligible). Valide aussi les invariants de saisie (A2/A3).
    const { extension: extensionAjustements, deduction: deductionAjustements } =
      this.effetAjustements(saisie, prefixeMois);

    const heuresDeduites = (saisie.absences ?? [])
      .filter(estDeductible)
      .reduce((total, absence) => total.plus(absence.duree), Duree.zero())
      .plus(deductionAjustements);

    if (heuresDeduites.enMinutes > heuresReservees.enMinutes) {
      throw new DeductionExcessiveError(
        `heures déduites (${heuresDeduites.enHeures()}) > heures réservées du mois (${heuresReservees.enHeures()}) (INV-05)`,
      );
    }

    // Les jours ajoutés ponctuellement (dans le mois et la période de validité)
    // sont un dépassement : ils s'agrègent au complément facturé à la minute.
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
      complement: (saisie.complement ?? Duree.zero())
        .plus(complementJoursSup)
        .plus(extensionAjustements),
      heuresReservees,
      heuresDeduites,
    };
  }

  /**
   * Effet des ajustements d'heures réelles du mois : agrège l'extension (heures
   * hors plage contractuelle) et la réduction déductible (heures contractuelles
   * non couvertes, éligibles préavis/certificat). Valide au passage les invariants
   * de saisie : un ajustement ne porte que sur un **jour gardé** (A2), et une date
   * ne peut cumuler un ajustement avec une autre saisie datée (A3). Les ajustements
   * hors période de validité sont sans effet (comme les jours ajoutés).
   */
  private effetAjustements(
    saisie: SaisieGenerationCreche,
    prefixeMois: string,
  ): { extension: Duree; deduction: Duree } {
    const ajustements = (saisie.ajustements ?? []).filter((a) =>
      a.date.startsWith(prefixeMois),
    );
    if (ajustements.length === 0) {
      return { extension: Duree.zero(), deduction: Duree.zero() };
    }

    // Dates déjà porteuses d'une autre saisie datée (absence datée ou jour ajouté).
    const datesOccupees = new Set<string>();
    for (const absence of saisie.absences ?? []) {
      if (absence.date !== undefined) {
        datesOccupees.add(absence.date);
      }
    }
    for (const jour of saisie.joursSupplementaires ?? []) {
      datesOccupees.add(jour.date);
    }

    let extension = Duree.zero();
    let deduction = Duree.zero();
    const datesAjustees = new Set<string>();
    for (const ajustement of ajustements) {
      const jour = jourSemaineDeIso(ajustement.date);
      const plagesContrat = this.config.semaineType.plagesJour(jour);
      if (plagesContrat.length === 0) {
        throw new AjustementJourNonGardeError(
          `ajustement sur un jour non gardé (${ajustement.date}) : utiliser un jour ajouté`,
        );
      }
      if (
        datesOccupees.has(ajustement.date) ||
        datesAjustees.has(ajustement.date)
      ) {
        throw new SaisieJourEnConflitError(
          `plusieurs saisies datées sur le jour ${ajustement.date} : un jour porte un ajustement, une absence OU un jour ajouté, pas plusieurs (A3)`,
        );
      }
      datesAjustees.add(ajustement.date);

      // Hors période de validité : sans effet facturable (aligné jours ajoutés).
      if (!this.estDansPeriode(ajustement.date)) {
        continue;
      }
      const ecart = ecartAjustement(plagesContrat, ajustement.presence);
      extension = extension.plus(ecart.extension);
      if (estDeductible(ajustement)) {
        deduction = deduction.plus(ecart.reduction);
      }
    }
    return { extension, deduction };
  }
}
