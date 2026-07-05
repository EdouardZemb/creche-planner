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
import { expect, type Page } from '@playwright/test';
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

// --- Synchronisation des saisies de planning (anti-flakiness sous charge) ----
//
// Les calendriers écrivent le planning en DEBOUNCE (~800 ms) puis relisent le
// serveur au montage (useSaisieServeur). Deux courses rendaient les specs
// « écrire puis recharger » flaky sous charge — d'où ces deux helpers partagés.

/**
 * Exécute `action` (un clic « Confirmer »/« Supprimer »/« Réinitialiser » qui
 * déclenche l'écriture de planning debouncée) puis attend que l'enregistrement
 * serveur soit RÉELLEMENT abouti avant de rendre la main.
 *
 * Deux garde-fous cumulés, parce que le client API rejoue les échecs transitoires
 * (`requeteIdempotente` : 502/503/504 + TypeError réseau, cf. api/client.ts). Un
 * `waitForResponse` sur la seule MÉTHODE se résoudrait sur la 1ʳᵉ réponse — y
 * compris une 5xx rejouable — en laissant un rejeu EN VOL qu'un `page.reload()`
 * avorterait (démontage → abort), donc une écriture perdue (flakiness) :
 *   1) on n'attend QUE la réponse PUT de SUCCÈS (204, ou 200 par prudence),
 *      jamais une 5xx rejouable ;
 *   2) on attend le badge « Enregistré à … » (BarreStatutCalendrier), qui ne
 *      s'affiche qu'après le `.then()` du client (donc après la dernière
 *      tentative réussie) : preuve qu'aucune écriture n'est plus en vol.
 */
export async function attendreEnregistrementPlanning(
  page: Page,
  action: () => Promise<void>,
): Promise<void> {
  const reponse = page.waitForResponse(
    (r) =>
      /\/plannings\//.test(r.url()) &&
      r.request().method() === 'PUT' &&
      (r.status() === 204 || r.status() === 200),
  );
  await action();
  await reponse;
  await expect(page.getByText(/Enregistré à/).first()).toBeVisible();
}

/**
 * Recharge la page Planning puis attend la RELECTURE serveur du planning
 * (`GET /contrats/:id/plannings/:mois`, 2xx) que le composant lance au montage
 * (useSaisieServeur), AVANT de rendre la main.
 *
 * Sans cette attente, la réhydratation serveur peut se résoudre TARDIVEMENT sous
 * charge et ÉCRASER une saisie optimiste faite juste après le reload : le
 * brouillon sessionStorage laisse le test filer avant la fin du GET, puis le GET
 * tardif réhydrate l'ancien état → un jour qu'on vient de supprimer « réapparaît »
 * (« Gardé » attendu, « Ajusté » reçu). En consommant le GET ici, la
 * réhydratation est réglée une bonne fois avant toute nouvelle interaction.
 */
export async function rechargerEtRelirePlanning(page: Page): Promise<void> {
  const relecture = page.waitForResponse(
    (r) =>
      /\/plannings\//.test(r.url()) && r.request().method() === 'GET' && r.ok(),
  );
  await page.reload();
  await relecture;
}
