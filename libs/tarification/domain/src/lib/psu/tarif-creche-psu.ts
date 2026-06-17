import { Duree, Money } from '@creche-planner/shared-kernel';
import { CoutMois, LigneDeCout } from '../core/cout-mois.js';
import type { PolitiqueTarifaire } from '../core/politique-tarifaire.js';
import {
  exigerEntierStrictementPositif,
  exigerNombreNonNegatif,
} from '../core/garde.js';
import { DeductionExcessiveError } from '../core/tarification-error.js';
import {
  BAREME_EFFORT_PSU_2026,
  type BaremeEffortPsu,
} from './bareme-effort-psu.js';

/** Configuration contractuelle du tarif crèche PSU (données du Foyer + barème). */
export interface ConfigTarifCrechePsu {
  /** Ressources mensuelles retenues par la CNAF (doc 02 §0). */
  ressourcesMensuelles: Money;
  /** Nombre d'enfants à charge → taux d'effort (doc 02 §3.3). */
  nbEnfantsACharge: number;
  /** Barème CNAF applicable ; défaut : barème 2026. */
  bareme?: BaremeEffortPsu;
  /** Plancher de ressources CNAF (borne basse), optionnel (doc 02 §3.1). */
  plancher?: Money;
  /** Plafond de ressources CNAF (borne haute), optionnel (doc 02 §3.1). */
  plafond?: Money;
}

/** Une absence du mois, candidate à déduction PSU (doc 02 §3.2, INV-08). */
export interface AbsencePsu {
  /** Durée d'absence sur les heures réservées. */
  duree: Duree;
  /** Délai de préavis en jours pleins (≥ 2 j ⇒ déductible). */
  preavisJours: number;
  /** Absence pour maladie avec certificat médical (⇒ déductible). */
  certificatMaladie: boolean;
}

/** Saisie d'un mois PSU : contrat mensualisé + événements du mois. */
export interface SaisieMoisPsu {
  /** Heures annuelles contractualisées (doc 02 §7). */
  heuresAnnuellesContractualisees: number;
  /** Nombre de mensualités lissant l'année (ici 7). */
  nbMensualites: number;
  /** Dépassement horaire du mois, facturé à la minute (doc 02 §3.2). */
  complement?: Duree;
  /** Absences du mois ; seules les éligibles sont déduites. */
  absences?: readonly AbsencePsu[];
}

/** Arrondi à 2 décimales (centième d'heure) — mensualisation, doc 02 §3.1. */
function arrondiCentiemeHeure(heures: number): number {
  return Math.round(heures * 100) / 100;
}

/**
 * Une absence est déductible **uniquement** si elle est prévenue au moins 2
 * jours à l'avance **ou** justifiée par un certificat de maladie (doc 02 §3.2,
 * INV-08). Sinon elle reste facturée (incluse dans la mensualité).
 */
function estDeductible(absence: AbsencePsu): boolean {
  return absence.preavisJours >= 2 || absence.certificatMaladie;
}

/**
 * Stratégie tarifaire **crèche PSU / CNAF** (doc 02 §3). Calcule la mensualité
 * lissée, ajoute les dépassements à la minute et soustrait les absences
 * éligibles. Domaine pur, sans réseau.
 */
export class TarifCrechePsu implements PolitiqueTarifaire<SaisieMoisPsu> {
  readonly mode = 'CRECHE_PSU' as const;

  private readonly _tarifHoraire: Money;

  constructor(private readonly config: ConfigTarifCrechePsu) {
    const bareme = config.bareme ?? BAREME_EFFORT_PSU_2026;
    const ressourcesBornees = this.bornerRessources(
      config.ressourcesMensuelles,
    );
    this._tarifHoraire = ressourcesBornees.fois(
      bareme.taux(config.nbEnfantsACharge),
    );
  }

  /** Tarif horaire = ressources bornées × taux d'effort (CT-01). */
  get tarifHoraire(): Money {
    return this._tarifHoraire;
  }

  calculerCoutMois(saisie: SaisieMoisPsu): CoutMois {
    exigerNombreNonNegatif(
      saisie.heuresAnnuellesContractualisees,
      'heuresAnnuellesContractualisees',
    );
    exigerEntierStrictementPositif(saisie.nbMensualites, 'nbMensualites');

    const heuresMensualisees = arrondiCentiemeHeure(
      saisie.heuresAnnuellesContractualisees / saisie.nbMensualites,
    );
    const lignes: LigneDeCout[] = [
      LigneDeCout.debit(
        'Mensualité',
        this._tarifHoraire.fois(heuresMensualisees),
      ),
    ];

    if (saisie.complement !== undefined && !saisie.complement.estZero()) {
      lignes.push(
        LigneDeCout.debit(
          'Complément (dépassement)',
          this._tarifHoraire.fois(saisie.complement.enHeures()),
        ),
      );
    }

    const heuresDeduites = (saisie.absences ?? [])
      .filter(estDeductible)
      .reduce((total, absence) => total + absence.duree.enHeures(), 0);
    if (heuresDeduites > heuresMensualisees) {
      throw new DeductionExcessiveError(
        `heures déduites (${heuresDeduites}) > heures mensualisées (${heuresMensualisees}) (INV-05)`,
      );
    }
    if (heuresDeduites > 0) {
      lignes.push(
        LigneDeCout.credit(
          'Déduction absences',
          this._tarifHoraire.fois(heuresDeduites),
        ),
      );
    }

    return new CoutMois(lignes);
  }

  private bornerRessources(ressources: Money): Money {
    if (
      this.config.plafond !== undefined &&
      ressources.estSuperieurA(this.config.plafond)
    ) {
      return this.config.plafond;
    }
    if (
      this.config.plancher !== undefined &&
      this.config.plancher.estSuperieurA(ressources)
    ) {
      return this.config.plancher;
    }
    return ressources;
  }
}
