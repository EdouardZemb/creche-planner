import { Tranche } from '@creche-planner/shared-kernel';
import { TrancheInconnueError } from './referentiel-error.js';

/**
 * Convertit un niveau numérique (issu d'une saisie/persistance) en value object
 * `Tranche` du `shared-kernel` (INV-03). Lève si le niveau n'est pas dans {1,2,3}.
 */
export function trancheDepuisNiveau(niveau: number): Tranche {
  if (niveau === 1) {
    return Tranche.T1;
  }
  if (niveau === 2) {
    return Tranche.T2;
  }
  if (niveau === 3) {
    return Tranche.T3;
  }
  throw new TrancheInconnueError(
    `tranche inconnue : ${niveau} (1, 2 ou 3 attendu)`,
  );
}
