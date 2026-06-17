import type { JourSemaine } from './jour-semaine.js';
import { jourSemaineDeIso } from './jour-semaine.js';
import { joursDuMois } from './mois.js';
import type {
  PrestationsMoisAlsh,
  PrestationsMoisCantine,
  PrestationsMoisPeriscolaire,
} from './prestations-mois.types.js';

/** Inscriptions ABCM d'un jour d'école (doc 02 §4.1/§4.2). */
export interface InscriptionsJour {
  /** Jour de cantine réservé (déjeuner). */
  readonly cantine?: boolean;
  /** Séance périscolaire du matin réservée. */
  readonly periMatin?: boolean;
  /** Séance périscolaire du soir réservée. */
  readonly periSoir?: boolean;
}

/** Semaine type ABCM : jour d'école → inscriptions péri/cantine. */
export type SemaineTypeAbcm = Partial<Record<JourSemaine, InscriptionsJour>>;

/** Type de présence ALSH d'un jour (doc 02 §4.3). */
export type TypeAlsh = 'COMPLETE' | 'DEMI';

/** Un jour ALSH réservé (mercredi/vacances), saisi par date (doc 02 §4.3). */
export interface JourAlsh {
  /** Date ISO `YYYY-MM-DD`. */
  readonly date: string;
  /** Journée complète ou demi-journée. */
  readonly type: TypeAlsh;
  /** Repas réservé ce jour-là. */
  readonly repas?: boolean;
}

/** Configuration d'une inscription ABCM. */
export interface ConfigInscriptionAbcm {
  /** Semaine type des jours d'école (cantine + péri). */
  readonly semaine: SemaineTypeAbcm;
  /**
   * Début de validité ISO `YYYY-MM-DD` (inclus). Optionnel : par défaut aucune
   * borne basse (toute date couverte).
   */
  readonly valideDu?: string;
  /**
   * Fin de validité ISO `YYYY-MM-DD` (incluse). Optionnel : par défaut aucune
   * borne haute (toute date couverte).
   */
  readonly valideAu?: string;
}

/**
 * Exception ponctuelle d'un jour (« j'ajoute / je retire un jour ce mois-ci »),
 * surchargeant la semaine type pour une date précise. Un champ **présent**
 * (true/false) remplace la semaine type pour ce service ; un champ **absent**
 * hérite de la semaine type. Permet d'ajouter un service un jour non prévu
 * (`true`) comme d'en retirer un jour prévu (`false`).
 */
export interface ExceptionJour {
  /** Date ISO `YYYY-MM-DD` concernée. */
  readonly date: string;
  /** Cantine ce jour-là (override). */
  readonly cantine?: boolean;
  /** Périscolaire du matin ce jour-là (override). */
  readonly periMatin?: boolean;
  /** Périscolaire du soir ce jour-là (override). */
  readonly periSoir?: boolean;
}

/** Base commune des saisies mensuelles ABCM. */
interface SaisieMoisAbcm {
  /** Mois ISO `YYYY-MM`. */
  readonly mois: string;
  /** Jours non facturables (fériés/fermetures) fournis par le Référentiel. */
  readonly joursNonFacturables?: readonly string[];
  /** Ajustements ponctuels par date, surchargeant la semaine type. */
  readonly exceptions?: readonly ExceptionJour[];
}

/** Saisie cantine du mois. */
export interface SaisieGenerationCantine extends SaisieMoisAbcm {
  /** Cas PAI panier-repas : seule la part « garde » est facturée. */
  readonly pai?: boolean;
}

/** Saisie périscolaire du mois. */
export type SaisieGenerationPeriscolaire = SaisieMoisAbcm;

/** Saisie ALSH du mois (jours saisis explicitement, car vacances variables). */
export interface SaisieGenerationAlsh extends SaisieMoisAbcm {
  readonly joursAlsh: readonly JourAlsh[];
}

/**
 * Inscription ABCM (doc 02 §4) : semaine type des jours d'école (cantine, péri
 * matin/soir) + génération des quantités du mois en excluant les jours non
 * facturables (INV-04). Règle « réservé = facturé » (doc 02 §4.4 bis). L'ALSH
 * (mercredi/vacances) est saisi par dates explicites. Domaine pur, immuable.
 */
export class InscriptionAbcm {
  private constructor(private readonly config: ConfigInscriptionAbcm) {}

  static creer(config: ConfigInscriptionAbcm): InscriptionAbcm {
    return new InscriptionAbcm(config);
  }

  /** Inscriptions du jour de semaine (objet vide si aucune). */
  private inscriptionsJour(jour: JourSemaine): InscriptionsJour {
    return this.config.semaine[jour] ?? {};
  }

  /** Indexe les exceptions ponctuelles par date (dernière valeur conservée). */
  private indexerExceptions(
    exceptions: readonly ExceptionJour[] | undefined,
  ): Map<string, ExceptionJour> {
    return new Map((exceptions ?? []).map((e) => [e.date, e]));
  }

  /**
   * Inscriptions effectives d'une date : la semaine type, surchargée par
   * l'exception du jour si elle existe. `??` traite `false` comme une valeur
   * explicite (retrait), `undefined` comme un héritage de la semaine type.
   */
  private inscriptionsEffectives(
    iso: string,
    exceptions: ReadonlyMap<string, ExceptionJour>,
  ): InscriptionsJour {
    const base = this.inscriptionsJour(jourSemaineDeIso(iso));
    const exc = exceptions.get(iso);
    if (exc === undefined) {
      return base;
    }
    const cantine = exc.cantine ?? base.cantine;
    const periMatin = exc.periMatin ?? base.periMatin;
    const periSoir = exc.periSoir ?? base.periSoir;
    return {
      ...(cantine !== undefined ? { cantine } : {}),
      ...(periMatin !== undefined ? { periMatin } : {}),
      ...(periSoir !== undefined ? { periSoir } : {}),
    };
  }

  /** Vrai si la date ISO est dans la période de validité (bornes optionnelles). */
  private estDansPeriode(iso: string): boolean {
    if (this.config.valideDu !== undefined && iso < this.config.valideDu) {
      return false;
    }
    if (this.config.valideAu !== undefined && iso > this.config.valideAu) {
      return false;
    }
    return true;
  }

  /**
   * Vrai si au moins un jour du mois `YYYY-MM` est dans la période de validité.
   * Un mois entièrement hors période ne génère aucune prestation (Phase 9,
   * bug #2 : la cantine de Zoé ne doit pas apparaître avant la rentrée).
   */
  couvreMois(mois: string): boolean {
    return joursDuMois(mois).some((iso) => this.estDansPeriode(iso));
  }

  /**
   * Jours du mois facturables : dans la période de validité (INV hors période)
   * et hors jours non facturables (fériés/fermetures, INV-04).
   */
  private joursFacturables(saisie: SaisieMoisAbcm): string[] {
    const nonFacturables = new Set(saisie.joursNonFacturables ?? []);
    return joursDuMois(saisie.mois).filter(
      (iso) => this.estDansPeriode(iso) && !nonFacturables.has(iso),
    );
  }

  /** Génère les prestations cantine du mois (CT-10). */
  genererPrestationsCantine(
    saisie: SaisieGenerationCantine,
  ): PrestationsMoisCantine {
    const exceptions = this.indexerExceptions(saisie.exceptions);
    const nbJours = this.joursFacturables(saisie).filter(
      (iso) => this.inscriptionsEffectives(iso, exceptions).cantine === true,
    ).length;
    return { mode: 'CANTINE', nbJours, pai: saisie.pai ?? false };
  }

  /** Génère les prestations périscolaire du mois (CT-11). */
  genererPrestationsPeriscolaire(
    saisie: SaisieGenerationPeriscolaire,
  ): PrestationsMoisPeriscolaire {
    const exceptions = this.indexerExceptions(saisie.exceptions);
    let nbMatins = 0;
    let nbSoirs = 0;
    for (const iso of this.joursFacturables(saisie)) {
      const inscriptions = this.inscriptionsEffectives(iso, exceptions);
      if (inscriptions.periMatin === true) {
        nbMatins += 1;
      }
      if (inscriptions.periSoir === true) {
        nbSoirs += 1;
      }
    }
    return { mode: 'PERISCOLAIRE', nbMatins, nbSoirs };
  }

  /** Génère les prestations ALSH du mois (CT-12). */
  genererPrestationsAlsh(saisie: SaisieGenerationAlsh): PrestationsMoisAlsh {
    const prefixeMois = `${saisie.mois}-`;
    const nonFacturables = new Set(saisie.joursNonFacturables ?? []);
    let nbJourneesCompletes = 0;
    let nbDemiJournees = 0;
    let nbRepas = 0;
    for (const jour of saisie.joursAlsh) {
      if (
        !jour.date.startsWith(prefixeMois) ||
        !this.estDansPeriode(jour.date) ||
        nonFacturables.has(jour.date)
      ) {
        continue;
      }
      if (jour.type === 'COMPLETE') {
        nbJourneesCompletes += 1;
      } else {
        nbDemiJournees += 1;
      }
      if (jour.repas === true) {
        nbRepas += 1;
      }
    }
    return { mode: 'ALSH', nbJourneesCompletes, nbDemiJournees, nbRepas };
  }
}
