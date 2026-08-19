/**
 * Erreur de domaine typée (doc 03 §3) : on ne lève jamais de chaîne brute.
 * Les invariants des value objects lèvent une sous-classe de `DomainError`
 * dès la construction.
 */
export abstract class DomainError extends Error {
  protected constructor(message: string) {
    super(message);
    this.name = new.target.name;
  }
}

/** Montant monétaire strictement négatif (INV-06 : tout montant ≥ 0). */
export class MontantNegatifError extends DomainError {
  constructor(message: string) {
    super(message);
  }
}

/** Montant exprimé en centimes non entiers (INV-07 : centimes entiers). */
export class MontantNonEntierError extends DomainError {
  constructor(message: string) {
    super(message);
  }
}

/**
 * Barème de tranches RFR incohérent : niveau inconnu, ou aucune tranche applicable
 * (barème sans borne ouverte finale couvrant le RFR — SFD 30, DV-03).
 */
export class BaremeTranchesInvalideError extends DomainError {
  constructor(message: string) {
    super(message);
  }
}

/** Durée négative ou en minutes non entières (INV-01). */
export class DureeInvalideError extends DomainError {
  constructor(message: string) {
    super(message);
  }
}

/** Plage horaire dont la fin n'est pas strictement postérieure au début (INV-01). */
export class PlageHoraireInvalideError extends DomainError {
  constructor(message: string) {
    super(message);
  }
}

/**
 * Période de validité incohérente : borne au mauvais format ISO `YYYY-MM-DD`,
 * ou fin antérieure au début (socle versionnement, SFD 30).
 */
export class PeriodeInvalideError extends DomainError {
  constructor(message: string) {
    super(message);
  }
}

/** Aucune version d'une suite ne couvre la date demandée (socle versionnement). */
export class AucuneVersionApplicableError extends DomainError {
  constructor(message: string) {
    super(message);
  }
}

/**
 * Deux versions d'une même entité se chevauchent dans le temps : la résolution à
 * date serait ambiguë (socle versionnement, garde-fou de publication).
 */
export class ChevauchementVersionsError extends DomainError {
  constructor(message: string) {
    super(message);
  }
}

/**
 * Trou dans une suite de versions : un intervalle de dates n'est couvert par
 * aucune version, la continuité `[dateEffet → fin)` est rompue (socle versionnement).
 */
export class TrouDansVersionsError extends DomainError {
  constructor(message: string) {
    super(message);
  }
}

/**
 * Date ISO `YYYY-MM-DD` mal formée présentée à l'arithmétique de dates
 * (`date-iso.ts`). Seul le format est jugé : l'existence du jour ne l'est pas.
 */
export class DateIsoInvalideError extends DomainError {
  // `public` n'est pas décoratif : il élargit le constructeur `protected` de
  // `DomainError`, sans quoi la classe ne serait pas instanciable hors hiérarchie.
  public constructor(message: string) {
    super(message);
  }
}

/**
 * Horodatage de connaissance mal formé (`instant.ts`) : tout ce qui n'est pas un
 * ISO 8601 UTC de largeur fixe `YYYY-MM-DDTHH:MM:SS.sssZ` — un offset horaire
 * casserait la comparaison lexicographique sans rien signaler.
 */
export class InstantInvalideError extends DomainError {
  public constructor(message: string) {
    super(message);
  }
}

/** Année hors de la plage grégorienne (1583-9999) présentée au calcul des fériés. */
export class AnneeInvalideError extends DomainError {
  public constructor(message: string) {
    super(message);
  }
}
