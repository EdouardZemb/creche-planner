import { CoutMois } from '../core/cout-mois.js';

/**
 * Consolide le **coût de garde d'un mois pour le foyer** (doc 02 §2, CT-20) :
 * la somme, sur tous les couples (enfant × mode) et frais rattachés au mois,
 * des `CoutMois` produits par chaque politique. Les lignes sont concaténées en
 * préservant leur ordre ; le total agrégé est calculé par `CoutMois.total`
 * (débits − crédits, ≥ 0 par INV-06).
 */
export function consoliderCoutMoisFoyer(couts: readonly CoutMois[]): CoutMois {
  return new CoutMois(couts.flatMap((cout) => cout.lignes));
}
