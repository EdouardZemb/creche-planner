import type { JourSemaine } from './jour-semaine.js';
import { jourSemaineDeIso } from './jour-semaine.js';
import { joursDuMois } from './mois.js';
import type {
  PrestationsMoisAlsh,
  PrestationsMoisCantine,
  PrestationsMoisPeriscolaire,
} from './prestations-mois.types.js';

/** Type de présence ALSH d'un jour (doc 02 §4.3). */
export type TypeAlsh = 'COMPLETE' | 'DEMI';

/**
 * Inscription ALSH **récurrente** d'un jour de semaine (mercredi typiquement) :
 * formule (journée/demi) et repas, car la grille tarifaire distingue les trois
 * compteurs. Les vacances restent saisies par dates explicites (`JourAlsh`),
 * prioritaires sur la récurrence pour une même date.
 */
export interface JourAlshHebdo {
  /** Journée complète ou demi-journée. */
  readonly type: TypeAlsh;
  /** Repas réservé ce jour-là. */
  readonly repas?: boolean;
}

/** Inscriptions ABCM d'un jour d'école (doc 02 §4.1/§4.2). */
export interface InscriptionsJour {
  /** Jour de cantine réservé (déjeuner). */
  readonly cantine?: boolean;
  /** Séance périscolaire du matin réservée. */
  readonly periMatin?: boolean;
  /** Séance périscolaire du soir réservée. */
  readonly periSoir?: boolean;
  /** Inscription ALSH récurrente ce jour de semaine. */
  readonly alsh?: JourAlshHebdo;
}

/** Semaine type ABCM : jour d'école → inscriptions péri/cantine. */
export type SemaineTypeAbcm = Partial<Record<JourSemaine, InscriptionsJour>>;

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
  /**
   * ALSH ce jour-là (override de la récurrence hebdomadaire) : `false` retire
   * un jour prévu, `true` en ajoute un (formule du jour de semaine, à défaut
   * journée complète sans repas). Sans effet sur les `JourAlsh` explicites.
   */
  readonly alsh?: boolean;
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

/**
 * Saisie ALSH du mois : jours saisis explicitement (vacances variables), en
 * complément de l'éventuelle inscription hebdomadaire de la semaine type
 * (mercredis récurrents), ajustable par les `exceptions` datées.
 */
export interface SaisieGenerationAlsh extends SaisieMoisAbcm {
  readonly joursAlsh: readonly JourAlsh[];
}

/**
 * Inscription ABCM (doc 02 §4) : semaine type des jours d'école (cantine, péri
 * matin/soir, ALSH récurrent) + génération des quantités du mois en excluant
 * les jours non facturables (INV-04). Règle « réservé = facturé » (doc 02
 * §4.4 bis). L'ALSH ponctuel (vacances) est saisi par dates explicites,
 * prioritaires sur la récurrence hebdomadaire. Domaine pur, immuable.
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
    // ALSH : booléen d'override → configuration effective (retrait, ajout avec
    // la formule du jour de semaine ou journée complète par défaut, héritage).
    const alsh =
      exc.alsh === undefined
        ? base.alsh
        : exc.alsh
          ? (base.alsh ?? { type: 'COMPLETE' as const })
          : undefined;
    return {
      ...(cantine !== undefined ? { cantine } : {}),
      ...(periMatin !== undefined ? { periMatin } : {}),
      ...(periSoir !== undefined ? { periSoir } : {}),
      ...(alsh !== undefined ? { alsh } : {}),
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

  /**
   * Génère les prestations ALSH du mois (CT-12) : jours réservés par date
   * (vacances) + jours issus de l'inscription hebdomadaire (mercredis), les
   * dates explicites primant sur la récurrence (leur formule/repas gagne, pas
   * de double comptage). Les exceptions datées (`alsh`) n'ajustent que la
   * récurrence.
   */
  genererPrestationsAlsh(saisie: SaisieGenerationAlsh): PrestationsMoisAlsh {
    const prefixeMois = `${saisie.mois}-`;
    const nonFacturables = new Set(saisie.joursNonFacturables ?? []);
    const exceptions = this.indexerExceptions(saisie.exceptions);
    let nbJourneesCompletes = 0;
    let nbDemiJournees = 0;
    let nbRepas = 0;
    const compter = (type: TypeAlsh, repas: boolean | undefined): void => {
      if (type === 'COMPLETE') {
        nbJourneesCompletes += 1;
      } else {
        nbDemiJournees += 1;
      }
      if (repas === true) {
        nbRepas += 1;
      }
    };
    const datesExplicites = new Set<string>();
    for (const jour of saisie.joursAlsh) {
      if (
        !jour.date.startsWith(prefixeMois) ||
        !this.estDansPeriode(jour.date) ||
        nonFacturables.has(jour.date)
      ) {
        continue;
      }
      datesExplicites.add(jour.date);
      compter(jour.type, jour.repas);
    }
    for (const iso of this.joursFacturables(saisie)) {
      if (datesExplicites.has(iso)) {
        continue;
      }
      const alsh = this.inscriptionsEffectives(iso, exceptions).alsh;
      if (alsh !== undefined) {
        compter(alsh.type, alsh.repas);
      }
    }
    return { mode: 'ALSH', nbJourneesCompletes, nbDemiJournees, nbRepas };
  }
}
