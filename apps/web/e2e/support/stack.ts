/**
 * Helpers partagés des tests E2E « stack réelle » (Phase 15, Lot 1).
 *
 * Le Lot 2 importe ces helpers. Ils restent volontairement minimaux :
 *  - lecture de l'état du seed (UUID créés par scripts/seed-demo.mjs) ;
 *  - construction des URL des pages foyer (relatives à la baseURL Playwright).
 *
 * NB : le dossier e2e/ n'est dans aucun tsconfig (Playwright compile via esbuild),
 * on peut donc utiliser librement node:fs / node:path / node:url ici.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

/** Forme du fichier scripts/.seed-demo-state.json écrit par le seed. */
export interface EtatSeed {
  foyerId: string;
  contrats: Record<string, string>;
}

// Chemin vers scripts/.seed-demo-state.json, résolu depuis CE fichier.
// apps/web/e2e/support/ → remonter 4 niveaux jusqu'à la racine du dépôt, puis scripts/.
const RACINE_REPO = join(
  dirname(fileURLToPath(import.meta.url)),
  '..',
  '..',
  '..',
  '..',
);
const CHEMIN_ETAT_SEED = join(RACINE_REPO, 'scripts', '.seed-demo-state.json');

/**
 * Lit l'état du seed (UUID du foyer et des contrats créés par scripts/seed-demo.mjs).
 * Lève une erreur explicite si le fichier est absent ou que le foyerId est nul
 * (le seed n'a pas tourné).
 */
export function lireEtatSeed(): EtatSeed {
  let brut: string;
  try {
    brut = readFileSync(CHEMIN_ETAT_SEED, 'utf8');
  } catch {
    throw new Error(
      "État du seed introuvable : lancer scripts/seed-demo.mjs d'abord",
    );
  }
  const etat = JSON.parse(brut) as Partial<EtatSeed>;
  if (!etat.foyerId) {
    throw new Error(
      "État du seed introuvable : lancer scripts/seed-demo.mjs d'abord",
    );
  }
  return { foyerId: etat.foyerId, contrats: etat.contrats ?? {} };
}

/** UUID du foyer seedé (raccourci pratique sur lireEtatSeed). */
export const FOYER_ID = (): string => lireEtatSeed().foyerId;

// --- Construction des URL des pages foyer (relatives à la baseURL) ----------

/** URL de la page Contrats d'un foyer. */
export const urlContrats = (foyerId: string): string =>
  `/foyers/${foyerId}/contrats`;

/** URL de la page Planning d'un foyer. */
export const urlPlanning = (foyerId: string): string =>
  `/foyers/${foyerId}/planning`;

/** URL de la page Coûts annuels d'un foyer. */
export const urlCouts = (foyerId: string): string => `/foyers/${foyerId}/couts`;
