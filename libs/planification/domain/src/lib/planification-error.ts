import { DomainError } from '@creche-planner/shared-kernel';

/**
 * Erreurs propres au domaine Planification. Toutes dérivent de `DomainError`
 * (doc 03 §3) : on ne lève jamais de chaîne brute, et chaque invariant cassé
 * porte un type identifiable.
 */

/** Date ISO (`YYYY-MM-DD`) non interprétable ou hors calendrier (INV-01). */
export class DateInvalideError extends DomainError {
  constructor(message: string) {
    super(message);
  }
}

/** Mois ISO (`YYYY-MM`) non interprétable. */
export class MoisInvalideError extends DomainError {
  constructor(message: string) {
    super(message);
  }
}

/** Période contractuelle dont la fin précède le début (INV-01). */
export class PeriodeContratInvalideError extends DomainError {
  constructor(message: string) {
    super(message);
  }
}

/** Paramètre contractuel non entier ou négatif (heures, mensualités) (INV-01). */
export class ParametreContratInvalideError extends DomainError {
  constructor(message: string) {
    super(message);
  }
}

/** Heures déduites du mois supérieures aux heures réservées du mois (INV-05). */
export class DeductionExcessiveError extends DomainError {
  constructor(message: string) {
    super(message);
  }
}

/** Comparaison de deux plannings portant sur des mois différents. */
export class MoisIncoherentError extends DomainError {
  constructor(message: string) {
    super(message);
  }
}
