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
