import { DomainError } from '@creche-planner/shared-kernel';

/**
 * Erreurs propres au domaine Référentiel (catalogue tarifaire versionné).
 * Toutes dérivent de `DomainError` (doc 03 §3) : chaque invariant cassé porte un
 * type identifiable, jamais une chaîne brute.
 *
 * Les erreurs du **socle versionné** (période invalide, aucune version applicable,
 * chevauchement) sont désormais définies dans le `shared-kernel` (SFD 30, D7) et
 * ré-exportées ici sous leurs noms historiques — `VersionsChevauchantesError` est
 * l'alias du `ChevauchementVersionsError` mutualisé.
 */

export {
  PeriodeInvalideError,
  AucuneVersionApplicableError,
  ChevauchementVersionsError as VersionsChevauchantesError,
} from '@creche-planner/shared-kernel';

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
