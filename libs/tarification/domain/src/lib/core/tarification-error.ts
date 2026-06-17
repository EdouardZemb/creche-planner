import { DomainError } from '@creche-planner/shared-kernel';

/**
 * Erreurs propres au domaine tarifaire. Toutes dérivent de `DomainError`
 * (doc 03 §3) : on ne lève jamais de chaîne brute, et chaque invariant cassé
 * porte un type identifiable.
 */

/** Quantité (jours, séances, repas, mensualités…) négative ou non entière (INV-01). */
export class QuantiteInvalideError extends DomainError {
  constructor(message: string) {
    super(message);
  }
}

/** `nbEnfantsACharge` hors barème CNAF connu pour le mode PSU (INV-02). */
export class TauxEffortInconnuError extends DomainError {
  constructor(message: string) {
    super(message);
  }
}

/** Grille ABCM absente pour la tranche / la prestation demandée (INV-03). */
export class GrilleIndisponibleError extends DomainError {
  constructor(message: string) {
    super(message);
  }
}

/** Heures déduites supérieures aux heures réservées du mois (INV-05). */
export class DeductionExcessiveError extends DomainError {
  constructor(message: string) {
    super(message);
  }
}
