import { DomainError } from '@creche-planner/shared-kernel';

/**
 * Erreurs propres au domaine Référentiel (catalogue tarifaire versionné).
 * Toutes dérivent de `DomainError` (doc 03 §3) : chaque invariant cassé porte un
 * type identifiable, jamais une chaîne brute.
 */

/** Période de validité incohérente (format ISO invalide ou fin < début). */
export class PeriodeInvalideError extends DomainError {
  constructor(message: string) {
    super(message);
  }
}

/** Mode de garde hors du vocabulaire métier (doc 02 §1). */
export class ModeGardeInconnuError extends DomainError {
  constructor(message: string) {
    super(message);
  }
}

/** Tranche RFR hors {1, 2, 3} (INV-03). */
export class TrancheInconnueError extends DomainError {
  constructor(message: string) {
    super(message);
  }
}

/** Aucune version du catalogue ne couvre la date demandée. */
export class AucuneVersionApplicableError extends DomainError {
  constructor(message: string) {
    super(message);
  }
}

/** Deux versions d'une même clé se chevauchent dans le temps (ambiguïté). */
export class VersionsChevauchantesError extends DomainError {
  constructor(message: string) {
    super(message);
  }
}
