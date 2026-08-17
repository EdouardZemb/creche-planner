import { Logger } from '@nestjs/common';

/**
 * Briques de **résilience** partagées des clients REST du monorepo (Phase 7,
 * factorisées en Phase 11 / DEC-08). Utilisées à la fois :
 *
 * - par la **gateway** (BFF) vers les services amont (foyer, planification,
 *   tarification) — propagation d'erreur (`executerResilient`) ;
 * - par les **clients de repli synchrone** de la tarification, quand le read
 *   model est froid/incomplet pour un (foyer, mois) — dégradation propre
 *   (`executerOuRepli`).
 *
 * Dans les deux cas les appels doivent être bornés et tolérants à la panne :
 *
 * - **timeout** : un appel ne peut bloquer la requête entrante indéfiniment ;
 * - **retry borné** : on retente un petit nombre de fois (échecs transitoires) ;
 * - **circuit-breaker** : après N échecs consécutifs, le circuit s'**ouvre** et les
 *   appels échouent immédiatement (fail-fast) pendant un délai de refroidissement,
 *   puis passe **semi-ouvert** (un essai sonde la reprise) avant de se refermer.
 *
 * Aucune dépendance métier : implémentation volontairement minimale et testable.
 */

/** Paramètres d'un appel résilient. */
export interface OptionsResilience {
  /** Délai maximal d'un essai (ms). */
  readonly timeoutMs: number;
  /** Nombre de tentatives supplémentaires après le 1ᵉʳ essai (≥ 0). */
  readonly retries: number;
  /**
   * Pause de **base** entre deux tentatives (ms) : doublée à chaque essai
   * (backoff exponentiel) puis brouillée par le jitter — deux appelants tombés
   * en panne au même instant ne rejouent pas au même instant (AM-42).
   */
  readonly delaiEntreEssaisMs: number;
  /** Plafond du délai entre essais (ms), backoff compris. Défaut : 30 000. */
  readonly delaiMaxMs?: number;
  /**
   * Discrimine les erreurs qui méritent un ré-essai. Absent ⇒ tout est rejoué
   * (comportement historique). Les clients HTTP passent
   * `estErreurHttpRejouable` : un 4xx définitif (hors 408/429) est
   * déterministe, le rejouer ne peut que recommencer la même réponse.
   */
  readonly estRejouable?: (erreur: unknown) => boolean;
  /** Source d'aléa du jitter, injectable en test. Défaut : `Math.random`. */
  readonly aleatoire?: () => number;
}

/** État d'un disjoncteur. */
export type EtatCircuit = 'ferme' | 'ouvert' | 'semi-ouvert';

/**
 * Disjoncteur simple à seuil d'échecs consécutifs. `ferme` → on laisse passer ;
 * après `seuilEchecs` échecs il s'`ouvre` (fail-fast) ; après `refroidissementMs`
 * il devient `semi-ouvert` (un seul essai sonde la reprise — succès ⇒ fermé,
 * échec ⇒ rouvert). Conçu pour être partagé par un client (une instance par
 * dépendance amont).
 */
export class CircuitBreaker {
  private echecsConsecutifs = 0;
  private ouvertDepuis: number | undefined = undefined;

  constructor(
    private readonly seuilEchecs = 3,
    private readonly refroidissementMs = 10000,
    private readonly maintenant: () => number = Date.now,
  ) {}

  /** État courant, en tenant compte du passage automatique en semi-ouvert. */
  etat(): EtatCircuit {
    if (this.ouvertDepuis === undefined) {
      return 'ferme';
    }
    if (this.maintenant() - this.ouvertDepuis >= this.refroidissementMs) {
      return 'semi-ouvert';
    }
    return 'ouvert';
  }

  /** Vrai si un appel peut tenter de passer (fermé ou en sonde semi-ouverte). */
  autoriseAppel(): boolean {
    return this.etat() !== 'ouvert';
  }

  /** Un appel a réussi : on referme le circuit et on remet le compteur à zéro. */
  succes(): void {
    this.echecsConsecutifs = 0;
    this.ouvertDepuis = undefined;
  }

  /** Un appel a échoué : on incrémente et on ouvre au-delà du seuil. */
  echec(): void {
    this.echecsConsecutifs += 1;
    if (this.echecsConsecutifs >= this.seuilEchecs) {
      this.ouvertDepuis = this.maintenant();
    }
  }
}

/** Erreur levée quand le disjoncteur est ouvert (fail-fast, sans appel réseau). */
export class CircuitOuvertError extends Error {
  constructor(nom: string) {
    super(`circuit ouvert pour « ${nom} » — appel court-circuité`);
    this.name = 'CircuitOuvertError';
  }
}

/**
 * `fetch` borné par un `AbortController` (timeout dur). Le paramètre optionnel
 * `init` permet d'émettre des requêtes POST/PUT avec corps JSON (la gateway
 * relaie aussi des écritures), tout en conservant le signal d'abandon. Les
 * clients de repli (lecture seule) l'appellent sans `init`.
 */
export async function fetchAvecTimeout(
  url: string,
  timeoutMs: number,
  init: RequestInit = {},
): Promise<Response> {
  const controleur = new AbortController();
  const minuteur = setTimeout(() => {
    controleur.abort();
  }, timeoutMs);
  try {
    return await fetch(url, { ...init, signal: controleur.signal });
  } finally {
    clearTimeout(minuteur);
  }
}

function pause(ms: number): Promise<void> {
  return new Promise((resoudre) => setTimeout(resoudre, ms));
}

/**
 * Délai avant le prochain essai : backoff exponentiel (base × 2^essais déjà
 * joués, plafonné) avec jitter « equal » — moitié fixe, moitié aléatoire. La
 * moitié fixe garantit un espacement minimal réel ; la moitié aléatoire
 * désynchronise les appelants qui échouent en même temps (retry storm).
 */
function delaiAvantEssai(
  options: OptionsResilience,
  essaisEffectues: number,
): number {
  const brut = Math.min(
    options.delaiMaxMs ?? 30000,
    options.delaiEntreEssaisMs * 2 ** essaisEffectues,
  );
  const aleatoire = options.aleatoire ?? Math.random;
  return brut / 2 + aleatoire() * (brut / 2);
}

/**
 * Exécute `operation` avec retry borné **et** disjoncteur. Si le circuit est
 * ouvert, échoue immédiatement (`CircuitOuvertError`). Sinon tente jusqu'à
 * `retries + 1` fois ; à la 1ʳᵉ réussite, ferme le circuit ; si toutes échouent,
 * enregistre l'échec (qui peut ouvrir le circuit) et propage la dernière erreur.
 */
export async function executerResilient<T>(
  nom: string,
  operation: () => Promise<T>,
  breaker: CircuitBreaker,
  options: OptionsResilience,
): Promise<T> {
  if (!breaker.autoriseAppel()) {
    throw new CircuitOuvertError(nom);
  }
  let derniereErreur: unknown;
  for (let essai = 0; essai <= options.retries; essai += 1) {
    try {
      const resultat = await operation();
      breaker.succes();
      return resultat;
    } catch (erreur) {
      derniereErreur = erreur;
      if (options.estRejouable !== undefined && !options.estRejouable(erreur)) {
        // Erreur **déterministe** de l'amont (4xx métier : 404, 409, 422…) : elle
        // prouve que la dépendance répond, et la réponse ne changera pas d'une
        // tentative à l'autre. Elle n'est donc **ni** un motif de retry **ni** une
        // panne à compter — c'est cette seconde moitié qui manquait. Un refus
        // parfaitement sain, répété trois fois, ouvrait le disjoncteur ; la sonde
        // de demi-ouverture retombait sur le même refus et le rouvrait aussitôt,
        // et TOUS les appels de ce client, pour tous les foyers, tournaient au 502.
        // Sans `estRejouable` (appelants non HTTP), le comptage est inchangé.
        throw erreur instanceof Error ? erreur : new Error(String(erreur));
      }
      if (essai >= options.retries) {
        break;
      }
      await pause(delaiAvantEssai(options, essai));
    }
  }
  breaker.echec();
  throw derniereErreur instanceof Error
    ? derniereErreur
    : new Error(String(derniereErreur));
}

/**
 * Variante « dégradation propre » : exécute l'appel résilient et, en cas d'échec
 * total (circuit ouvert compris), journalise un avertissement et renvoie une
 * valeur de repli plutôt que de propager — l'appelant ne plante jamais à cause
 * d'une dépendance amont injoignable.
 */
export async function executerOuRepli<T>(
  nom: string,
  operation: () => Promise<T>,
  repli: T,
  breaker: CircuitBreaker,
  options: OptionsResilience,
  logger: Logger,
): Promise<T> {
  try {
    return await executerResilient(nom, operation, breaker, options);
  } catch (erreur) {
    logger.warn(
      `Dépendance « ${nom} » indisponible (${(erreur as Error).message}) — repli appliqué`,
    );
    return repli;
  }
}
