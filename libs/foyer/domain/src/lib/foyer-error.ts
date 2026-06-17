import { DomainError } from '@creche-planner/shared-kernel';

/**
 * Erreurs propres au domaine Foyer. Toutes dérivent de `DomainError`
 * (doc 03 §3) : on ne lève jamais de chaîne brute, et chaque invariant cassé
 * porte un type identifiable.
 */

/** Prénom d'enfant vide ou uniquement composé d'espaces. */
export class PrenomInvalideError extends DomainError {
  constructor(message: string) {
    super(message);
  }
}

/** Date de naissance non interprétable (instant `NaN`). */
export class DateNaissanceInvalideError extends DomainError {
  constructor(message: string) {
    super(message);
  }
}

/** `nbEnfantsACharge` non entier ou inférieur à 1 (un foyer a au moins un enfant). */
export class EnfantsAChargeInvalideError extends DomainError {
  constructor(message: string) {
    super(message);
  }
}

/** `nbParts` non fini ou non strictement positif (quotient familial). */
export class NombreDePartsInvalideError extends DomainError {
  constructor(message: string) {
    super(message);
  }
}
