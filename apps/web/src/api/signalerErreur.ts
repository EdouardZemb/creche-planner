import { BASE, TOKEN } from './client';
import type { SchemaComposant } from './openapi-types';

/**
 * **Remontée des plantages client (lot C7, volet b).**
 *
 * Les six services backend sont instrumentés (OTel → Loki → Alertmanager) ; le
 * navigateur, lui, était le seul endroit du système où une panne ne produisait
 * AUCUN signal. Une exception de rendu chez un parent restait invisible :
 * personne ne l'apprenait, jamais.
 *
 * Point de collecte **même-origine** (`POST /api/v1/erreurs-client`), jamais un
 * service tiers : la CSP posée par A6 l'interdit déjà, et c'est bien ainsi. La
 * corrélation `trace_id` est posée **côté gateway** (instrumentation pino/OTel de
 * la requête POST), pas ici — le navigateur n'a pas de contexte de trace.
 *
 * Chemin de crash ⇒ contraintes propres :
 * - `fetch` **nu** (pas `requeteIdempotente`) : ni délai d'expiration, ni rejeu,
 *   ni disjoncteur. Un signal perdu est sans conséquence ; une tempête de rejeux
 *   depuis un navigateur qui plante, non ;
 * - `keepalive` : la remontée survit à la navigation/fermeture d'onglet qui suit
 *   souvent un plantage ;
 * - **ne lève jamais** et ne renvoie rien : appelée depuis `componentDidCatch` et
 *   depuis les gestionnaires globaux, une erreur ici en cascaderait une autre.
 */

/**
 * Corps du signalement — **DÉRIVÉ du contrat** (`components.schemas.ErreurClient`,
 * cf. `api/openapi-types.ts`), jamais réécrit à la main. La gateway dérive ses
 * origines acceptées du même endroit : le document OpenAPI est l'unique source.
 *
 * Champs : `origine` (où la frontière a intercepté — c'est l'étiquette qu'on lit
 * dans Loki), `message`, `route` (le `pathname` seul), `pile` et `composant`
 * optionnels.
 */
export type ErreurClient = SchemaComposant<'ErreurClient'>;

/** `application` | `route` | `chunk` | `globale` | `promesse`. */
export type OrigineErreurClient = ErreurClient['origine'];

/**
 * Plafond de signalements par chargement de page. Un rendu en boucle peut
 * rejouer la même exception des dizaines de fois par seconde : sans plafond, la
 * remontée transforme un plantage local en flood de la gateway (elle-même
 * protégée par `RateLimitGuard`, qui répondrait alors 429 à TOUTES les requêtes
 * du même client — y compris celles de l'app qui fonctionne encore).
 */
const MAX_PAR_CHARGEMENT = 5;

/** Bornes alignées sur celles du schéma de la gateway (400 au-delà). */
const MAX_MESSAGE = 500;
const MAX_PILE = 4000;
const MAX_COMPOSANT = 1000;

let envoyes = 0;
const dejaSignalees = new Set<string>();

/** Coupe une chaîne à `max` caractères (suffixe explicite, pas de coupe muette). */
function borner(valeur: string, max: number): string {
  return valeur.length <= max ? valeur : `${valeur.slice(0, max - 1)}…`;
}

/**
 * Remonte un plantage client. Sans effet visible : ni retour, ni exception, ni
 * attente. Doublons (même origine + même message) et débordements du plafond
 * sont ignorés en silence — c'est un signal, pas un journal exhaustif.
 */
export function signalerErreurClient(erreur: ErreurClient): void {
  const empreinte = `${erreur.origine}|${erreur.message}`;
  if (envoyes >= MAX_PAR_CHARGEMENT || dejaSignalees.has(empreinte)) {
    return;
  }
  dejaSignalees.add(empreinte);
  envoyes += 1;

  const entetes: Record<string, string> = {
    'Content-Type': 'application/json',
  };
  if (TOKEN) entetes['Authorization'] = `Bearer ${TOKEN}`;

  const corps = {
    origine: erreur.origine,
    message: borner(erreur.message, MAX_MESSAGE),
    // `route` = `pathname` seul, jamais `search` : les liens profonds du mail du
    // mardi portent `?semaine=` et l'URL de planning porte `?enfant=<prénom>` —
    // une donnée personnelle qui n'a rien à faire dans un journal d'exploitation.
    route: erreur.route,
    ...(erreur.pile !== undefined && { pile: borner(erreur.pile, MAX_PILE) }),
    ...(erreur.composant !== undefined && {
      composant: borner(erreur.composant, MAX_COMPOSANT),
    }),
  };

  try {
    void fetch(`${BASE}/v1/erreurs-client`, {
      method: 'POST',
      headers: entetes,
      body: JSON.stringify(corps),
      keepalive: true,
    }).catch(() => {
      /* la remontée est best-effort : un échec ne doit rien casser de plus */
    });
  } catch {
    /* `fetch` absent (environnement non-navigateur) ou corps non sérialisable */
  }
}

/** Normalise une valeur levée (on peut `throw` n'importe quoi) en message + pile. */
export function detaillerErreur(valeur: unknown): {
  message: string;
  pile?: string;
} {
  if (valeur instanceof Error) {
    return {
      message: valeur.message === '' ? valeur.name : valeur.message,
      ...(valeur.stack !== undefined && { pile: valeur.stack }),
    };
  }
  return { message: typeof valeur === 'string' ? valeur : String(valeur) };
}

/**
 * Branche les deux sources d'erreur que React ne voit PAS : les exceptions hors
 * rendu (`error`) et les promesses rejetées sans `catch` (`unhandledrejection`).
 * Les frontières d'erreur, elles, signalent depuis `componentDidCatch`.
 *
 * Appelé une fois au démarrage (`main.tsx`). Hors test, jamais démonté : la
 * fonction de retrait n'existe que pour les tests.
 */
export function installerRemonteeErreurs(): () => void {
  const surErreur = (evenement: ErrorEvent): void => {
    const details = detaillerErreur(evenement.error ?? evenement.message);
    signalerErreurClient({
      origine: 'globale',
      message: details.message,
      route: window.location.pathname,
      ...(details.pile !== undefined && { pile: details.pile }),
    });
  };
  const surRejet = (evenement: PromiseRejectionEvent): void => {
    const details = detaillerErreur(evenement.reason);
    signalerErreurClient({
      origine: 'promesse',
      message: details.message,
      route: window.location.pathname,
      ...(details.pile !== undefined && { pile: details.pile }),
    });
  };

  window.addEventListener('error', surErreur);
  window.addEventListener('unhandledrejection', surRejet);

  return () => {
    window.removeEventListener('error', surErreur);
    window.removeEventListener('unhandledrejection', surRejet);
  };
}

/** Remet à zéro plafond et déduplication — réservé aux tests. */
export function reinitialiserRemonteeErreurs(): void {
  envoyes = 0;
  dejaSignalees.clear();
}
