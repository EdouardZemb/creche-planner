import { Money } from '@creche-planner/shared-kernel';
import { GrilleIndisponibleError } from '../core/tarification-error.js';

/**
 * Tarifs ABCM d'une tranche RFR (doc 02 §4). Représentation **interne** : chaque
 * poste est un `Money` ou `undefined` (la grille peut être partielle — projetée
 * pour un seul mode). L'accès à un poste absent lève `GrilleIndisponibleError`.
 */
interface DonneesGrilleAbcm {
  /** Cantine — TOTAL repas + encadrement, par jour (doc 02 §4.1). */
  cantineTotal: Money | undefined;
  /** Cantine — part « garde » seule (cas PAI panier-repas, doc 02 §4.4 bis). */
  cantinePartGarde: Money | undefined;
  /** Périscolaire — séance du matin (doc 02 §4.2). */
  periMatin: Money | undefined;
  /** Périscolaire — séance du soir, 2 h (doc 02 §4.2). */
  periSoir: Money | undefined;
  /** ALSH — journée complète (doc 02 §4.3). */
  alshJourneeComplete: Money | undefined;
  /** ALSH — demi-journée (doc 02 §4.3). */
  alshDemiJournee: Money | undefined;
  /** ALSH — repas (doc 02 §4.3). */
  alshRepas: Money | undefined;
}

/**
 * Paramètres tarifaires ABCM en **centimes entiers** (forme du Référentiel projeté,
 * `referentiel.GrillePubliee.v2`). Tous les champs sont optionnels : un événement
 * projette une grille **par mode**, donc seuls les postes du mode concerné sont
 * renseignés. `null` (part « garde » absente pour la tranche) vaut « non défini ».
 */
export interface ParametresGrilleAbcm {
  readonly cantineTotalCentimes?: number;
  readonly cantinePartGardeCentimes?: number | null;
  readonly periMatinCentimes?: number;
  readonly periSoirCentimes?: number;
  readonly alshJourneeCompleteCentimes?: number;
  readonly alshDemiJourneeCentimes?: number;
  readonly alshRepasCentimes?: number;
}

/**
 * Grille tarifaire ABCM applicable à une tranche RFR (INV-03). Façade lecture
 * seule sur des barèmes **fournis en paramètres** (RM-30-04 : plus aucune valeur
 * tarifaire figée dans le domaine) ; ne fait aucun calcul de quantité.
 */
export class GrilleAbcm {
  private constructor(private readonly donnees: DonneesGrilleAbcm) {}

  /**
   * Construit une grille depuis des paramètres en centimes (Référentiel projeté).
   * Un poste absent (`undefined`) ou nul (`null`) reste indisponible : accéder au
   * getter correspondant lèvera `GrilleIndisponibleError`.
   */
  static depuisParametres(parametres: ParametresGrilleAbcm): GrilleAbcm {
    const money = (centimes: number | null | undefined): Money | undefined =>
      centimes === undefined || centimes === null
        ? undefined
        : Money.depuisCentimes(centimes);
    return new GrilleAbcm({
      cantineTotal: money(parametres.cantineTotalCentimes),
      cantinePartGarde: money(parametres.cantinePartGardeCentimes),
      periMatin: money(parametres.periMatinCentimes),
      periSoir: money(parametres.periSoirCentimes),
      alshJourneeComplete: money(parametres.alshJourneeCompleteCentimes),
      alshDemiJournee: money(parametres.alshDemiJourneeCentimes),
      alshRepas: money(parametres.alshRepasCentimes),
    });
  }

  /** Exige un poste tarifaire présent, sinon lève avec un libellé explicite. */
  private exiger(valeur: Money | undefined, libelle: string): Money {
    if (valeur === undefined) {
      throw new GrilleIndisponibleError(
        `${libelle} non défini pour cette grille`,
      );
    }
    return valeur;
  }

  get cantineTotal(): Money {
    return this.exiger(this.donnees.cantineTotal, 'tarif cantine');
  }

  /** Part « garde » de la cantine (PAI). Lève si la tranche ne la définit pas. */
  get cantinePartGarde(): Money {
    return this.exiger(
      this.donnees.cantinePartGarde,
      'part « garde » cantine (PAI)',
    );
  }

  get periMatin(): Money {
    return this.exiger(this.donnees.periMatin, 'tarif périscolaire matin');
  }

  get periSoir(): Money {
    return this.exiger(this.donnees.periSoir, 'tarif périscolaire soir');
  }

  get alshJourneeComplete(): Money {
    return this.exiger(
      this.donnees.alshJourneeComplete,
      'tarif ALSH journée complète',
    );
  }

  get alshDemiJournee(): Money {
    return this.exiger(this.donnees.alshDemiJournee, 'tarif ALSH demi-journée');
  }

  get alshRepas(): Money {
    return this.exiger(this.donnees.alshRepas, 'tarif ALSH repas');
  }
}
