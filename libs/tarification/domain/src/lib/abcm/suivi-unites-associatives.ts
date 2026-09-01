import type { Money } from '@creche-planner/shared-kernel';
import { exigerNombreNonNegatif } from '../core/garde.js';
import { UnitesAssociativesAbcm } from './unites-associatives-abcm.js';

/**
 * **Suivi des unités associatives** (SFD 40 §3.1) — le calcul des trois compteurs
 * d'un engagement de bénévolat, et le branchement du coût déjà écrit
 * (`UnitesAssociativesAbcm`, doc 02 §4.5) sur des heures **réellement saisies**.
 *
 * Ce module ne réécrit aucune formule : il donne une **entrée réelle** à celle qui
 * existait (`RM-40-03`). Tout ce qu'il ajoute est le tri des sessions en trois
 * populations disjointes — et ce tri est précisément là où un écran se trompe
 * (SFD 40 §3.1 : « le reste-à-faire n'est pas un nombre, c'en est trois »).
 *
 * Il est **pur** : aucune horloge, aucune I/O. Le jour de référence est un
 * paramètre, sans quoi « une session passée encore prévue » serait intestable.
 */

/** États d'une session de bénévolat (SFD 40 §3). */
export const ETATS_SESSION_UA = ['PREVUE', 'REALISEE', 'ANNULEE'] as const;
export type EtatSessionUa = (typeof ETATS_SESSION_UA)[number];

/**
 * Catalogue des **types** de créneau (SFD 40 §3, principe 2 : une donnée, pas une
 * union de branches). Aucun calcul ne s'y embranche — le type est porté de bout en
 * bout comme une étiquette, et c'est ce qui rend l'ajout d'un type possible sans
 * toucher au coût. `TALENT` couvre les savoir-faire valorisables tant qu'aucun
 * barème public n'existe (`Q-40-04`) : ils comptent en heures comme les autres.
 */
export const TYPES_SESSION_UA = [
  'MENAGE',
  'CANTINE',
  'GRAND_MENAGE',
  'CVE',
  'TALENT',
  'AUTRE',
] as const;
export type TypeSessionUa = (typeof TYPES_SESSION_UA)[number];

/** Une session de bénévolat, réduite à ce dont le calcul a besoin. */
export interface SessionUaCalcul {
  /** Date du créneau, ISO `YYYY-MM-DD` (comparaison lexicographique). */
  readonly date: string;
  /** Durée en heures ; décimale admise (une demi-heure de ménage existe). */
  readonly dureeHeures: number;
  readonly etat: EtatSessionUa;
}

/** L'engagement de la période, tel qu'il est **saisi** (jamais une constante). */
export interface EngagementUaCalcul {
  /** Quota d'unités associatives dues sur la période (1 UA = 1 h). */
  readonly quotaHeures: number;
  /** Valeur d'une UA non réalisée. */
  readonly valeurUa: Money;
  /** Fin de la période de comptage, ISO `YYYY-MM-DD` incluse (l'échéance). */
  readonly fin: string;
}

/**
 * Un coût projeté **avec son hypothèse** (`RM-40-05`). Un montant affiché sans
 * dire s'il suppose les créneaux réservés réalisés est un chiffre qui ment par
 * omission : l'hypothèse voyage donc avec le montant, jamais à côté.
 */
export interface CoutProjeteUa {
  readonly montantCentimes: number;
  readonly hypothese: 'SI_TU_TARRETES_LA' | 'SI_TU_REALISES_TES_RESERVATIONS';
}

/** Ce que le suivi d'un engagement rend (SFD 40, US-40-04). */
export interface SuiviUa {
  readonly quotaHeures: number;
  /** Σ des heures `REALISEE` — le seul compteur qui solde l'obligation (`RM-40-04`). */
  readonly heuresRealisees: number;
  /** Σ des heures `PREVUE` **à venir** : engagé, pas acquitté. */
  readonly heuresReservees: number;
  /**
   * Σ des heures `PREVUE` dont la date est **passée**. Ni réalisées ni réservées :
   * Martha ne décide pas à la place du parent (`RM-40-06`), et les compter d'un
   * côté ou de l'autre serait décider. Elles gonflent donc le restant, et l'écran
   * les signale « à confirmer ».
   */
  readonly heuresAConfirmer: number;
  /** `max(0, quota − réalisé − réservé)` : ce qu'il reste à aller chercher. */
  readonly heuresRestantes: number;
  /** Vrai dès que le réalisé seul solde le quota : caution rendue, 0 €. */
  readonly quotaAtteint: boolean;
  /** Jours **restants** avant l'échéance ; négatif si elle est dépassée. */
  readonly joursAvantEcheance: number;
  /** Coût si la période se terminait sur le seul réalisé. */
  readonly coutSiArret: CoutProjeteUa;
  /** Coût si les créneaux déjà réservés sont menés à terme. */
  readonly coutSiReservationsRealisees: CoutProjeteUa;
  /**
   * Vrai quand il reste des heures à trouver **et** que l'échéance est à moins du
   * seuil (US-40-05 CA1). Retombe à faux dès que le restant s'annule, sans action
   * du parent (CA3).
   */
  readonly alerteEcheance: boolean;
}

/** Seuil d'alerte par défaut, en jours (8 semaines, US-40-05 CA1). */
export const SEUIL_ALERTE_ECHEANCE_JOURS = 56;

const MS_PAR_JOUR = 86_400_000;

/**
 * Nombre de jours **entiers** entre deux dates ISO `YYYY-MM-DD`, bornes prises à
 * minuit UTC. `Date.UTC` plutôt que `new Date(iso)` : ce dernier interprète une
 * date nue en UTC mais un `YYYY-MM-DDTHH:mm` en local, et mélanger les deux fait
 * apparaître ou disparaître un jour selon le fuseau du serveur.
 */
export function joursEntre(du: string, au: string): number {
  return Math.round((instantUtc(au) - instantUtc(du)) / MS_PAR_JOUR);
}

function instantUtc(iso: string): number {
  // `Number(undefined)` vaut `NaN` : une chaîne mal formée rend `NaN`, jamais une
  // date silencieusement fausse. Pas de repli `?? 0` — il inventerait une date, et
  // resterait une branche que rien ne peut atteindre depuis une entrée validée.
  const parties = iso.split('-');
  return Date.UTC(
    Number(parties[0]),
    Number(parties[1]) - 1,
    Number(parties[2]),
  );
}

/**
 * Calcule les trois compteurs, l'échéance et les deux coûts projetés d'un
 * engagement, à un jour de référence donné.
 *
 * @param engagement quota, valeur d'UA et fin de période — tous **saisis**
 * @param sessions les sessions de la période, tous états confondus
 * @param aujourdhui jour de référence ISO `YYYY-MM-DD` (jamais lu d'une horloge ici)
 * @param seuilAlerteJours seuil d'alerte d'échéance, en jours
 */
export function calculerSuiviUa(
  engagement: EngagementUaCalcul,
  sessions: readonly SessionUaCalcul[],
  aujourdhui: string,
  seuilAlerteJours: number = SEUIL_ALERTE_ECHEANCE_JOURS,
): SuiviUa {
  exigerNombreNonNegatif(engagement.quotaHeures, 'quotaHeures');
  let heuresRealisees = 0;
  let heuresReservees = 0;
  let heuresAConfirmer = 0;
  for (const session of sessions) {
    exigerNombreNonNegatif(session.dureeHeures, 'dureeHeures');
    if (session.etat === 'REALISEE') {
      heuresRealisees += session.dureeHeures;
    } else if (session.etat === 'PREVUE') {
      if (session.date >= aujourdhui) {
        heuresReservees += session.dureeHeures;
      } else {
        heuresAConfirmer += session.dureeHeures;
      }
    }
    // `ANNULEE` ne compte nulle part : une annulation **remonte** le restant
    // (US-40-03 CA2), elle ne laisse pas de trace dans les compteurs.
  }
  const heuresRestantes = Math.max(
    0,
    engagement.quotaHeures - heuresRealisees - heuresReservees,
  );
  const joursAvantEcheance = joursEntre(aujourdhui, engagement.fin);
  return {
    quotaHeures: engagement.quotaHeures,
    heuresRealisees,
    heuresReservees,
    heuresAConfirmer,
    heuresRestantes,
    quotaAtteint: heuresRealisees >= engagement.quotaHeures,
    joursAvantEcheance,
    coutSiArret: {
      montantCentimes: coutCentimes(engagement, heuresRealisees),
      hypothese: 'SI_TU_TARRETES_LA',
    },
    coutSiReservationsRealisees: {
      montantCentimes: coutCentimes(
        engagement,
        heuresRealisees + heuresReservees,
      ),
      hypothese: 'SI_TU_REALISES_TES_RESERVATIONS',
    },
    alerteEcheance:
      heuresRestantes > 0 && joursAvantEcheance <= seuilAlerteJours,
  };
}

/**
 * Le branchement lui-même : la politique tarifaire **déjà écrite et testée**
 * (`UnitesAssociativesAbcm`) appelée sur des heures saisies, avec le quota et la
 * valeur d'UA de l'engagement — pas les défauts de son constructeur. C'est tout
 * le sujet de la SFD 40 §1.1 : la classe était complète, testée en mutation, et
 * n'était appelée par personne.
 */
function coutCentimes(
  engagement: EngagementUaCalcul,
  heuresRealisees: number,
): number {
  const politique = new UnitesAssociativesAbcm({
    quotaHeures: engagement.quotaHeures,
    valeurUa: engagement.valeurUa,
  });
  return politique.calculerCoutMois({ heuresRealisees }).total.centimes;
}
