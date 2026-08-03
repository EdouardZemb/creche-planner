import { Injectable } from '@nestjs/common';
import {
  HealthIndicatorService,
  type HealthIndicatorResult,
} from '@nestjs/terminus';
import { fetchAvecTimeout } from '@creche-planner/resilience';
import { loadConfig } from '../config.js';

/**
 * Délai d'une sonde d'amont. Court volontairement : la readiness d'un `svc-*` est
 * un `select 1` plus deux lectures en mémoire (migrations appliquées, connexion
 * NATS) — un amont qui met plus de deux secondes à y répondre est de toute façon
 * inutilisable pour une requête parent.
 */
const SONDE_TIMEOUT_MS = 2_000;

/**
 * Durée de vie d'un lot de verdicts. La readiness de la gateway est relue en
 * boucle (Porte 3 du déploiement : `curl --retry 10 --retry-delay 3` ; smoke CI ;
 * heartbeat) : un cache court garantit qu'aucune de ces boucles ne relit un verdict
 * périmé, tout en évitant qu'une rafale de requêtes se traduise par une rafale
 * d'appels aux 5 amonts (contrainte du lot B3 : pas de sonde synchrone par requête).
 */
const LOT_TTL_MS = 5_000;

/** Un amont sondé : la clé sous laquelle il est rapporté, l'origine de son API. */
interface Amont {
  readonly cle: string;
  readonly url: string;
}

/** Verdict d'une sonde : prêt, ou pas prêt **avec** de quoi nommer la cause. */
type Verdict =
  | { readonly ok: true }
  | { readonly ok: false; readonly detail: Record<string, unknown> };

/** Les 5 amonts, relus à chaque lot : l'environnement fait foi. */
function listerAmonts(): Amont[] {
  const config = loadConfig();
  return [
    { cle: 'svc-referentiel', url: config.referentielUrl },
    { cle: 'svc-foyer', url: config.foyerUrl },
    { cle: 'svc-planification', url: config.planificationUrl },
    { cle: 'svc-tarification', url: config.tarificationUrl },
    { cle: 'svc-notifications', url: config.notificationsUrl },
  ];
}

/**
 * Sonde la **readiness** de l'amont (`/api/health`), pas sa liveness : c'est la
 * readiness qui couvre base + migrations + NATS. Un service dont le process répond
 * mais dont les migrations bouclent en retry est vivant et NON prêt — c'est
 * exactement l'état qui faisait partir le seed en 502/503 (cause racine du lot B3).
 */
async function sonder(amont: Amont): Promise<Verdict> {
  try {
    const reponse = await fetchAvecTimeout(
      `${amont.url}/api/health`,
      SONDE_TIMEOUT_MS,
    );
    return reponse.ok
      ? { ok: true }
      : { ok: false, detail: { httpStatus: reponse.status } };
  } catch (erreur) {
    return { ok: false, detail: { message: (erreur as Error).message } };
  }
}

/** Sonde les 5 amonts en parallèle. Ne rejette jamais : chaque échec est un verdict. */
async function sonderTous(): Promise<ReadonlyMap<string, Verdict>> {
  const verdicts = await Promise.all(
    listerAmonts().map(
      async (amont) => [amont.cle, await sonder(amont)] as const,
    ),
  );
  return new Map(verdicts);
}

/**
 * Readiness de la **chaîne** : la gateway ne se déclare prête que si ses 5 amonts
 * le sont (lot B3). Elle ne portait jusqu'ici qu'une sonde de liveness sur
 * svc-referentiel — elle répondait donc « prête » alors qu'aucun de ses amonts
 * n'acceptait de trafic, d'où les 502/503 de la toute première écriture du seed
 * (pansement : le rejeu 30 s de `scripts/seed-demo.mjs`).
 *
 * **Readiness seulement** : les healthchecks compose et la sonde blackbox restent
 * sur `/api/health/live`, qui ne dépend de rien (contrainte héritée des lots A6/A7 —
 * y accrocher un amont déclencherait des restarts en cascade).
 */
@Injectable()
export class AmontsHealthIndicator {
  /** Lot courant : les 5 verdicts partagés, et l'instant où ils périment. */
  private lot:
    | {
        readonly expire: number;
        readonly verdicts: Promise<ReadonlyMap<string, Verdict>>;
      }
    | undefined;

  constructor(private readonly health: HealthIndicatorService) {}

  /**
   * Une sonde terminus **par** amont : le rapport nomme le service fautif
   * (`{"svc-foyer":{"status":"down","httpStatus":503}}`) plutôt qu'un « amonts KO »
   * opaque qu'il faudrait aller diagnostiquer service par service. Les 5 lisent le
   * MÊME lot mis en cache : 5 sondes rapportées = 1 rafale d'appels au plus.
   */
  sondes(): (() => Promise<HealthIndicatorResult>)[] {
    return listerAmonts().map((amont) => () => this.etat(amont));
  }

  private async etat(amont: Amont): Promise<HealthIndicatorResult> {
    const indicateur = this.health.check(amont.cle);
    const verdict = (await this.verdicts()).get(amont.cle);
    if (verdict?.ok === true) {
      return indicateur.up();
    }
    return verdict === undefined
      ? indicateur.down({ message: 'amont absent du lot de sondes' })
      : indicateur.down(verdict.detail);
  }

  /** Le lot courant, re-sondé seulement s'il a dépassé son TTL. */
  private verdicts(): Promise<ReadonlyMap<string, Verdict>> {
    const maintenant = Date.now();
    if (this.lot === undefined || maintenant >= this.lot.expire) {
      this.lot = { expire: maintenant + LOT_TTL_MS, verdicts: sonderTous() };
    }
    return this.lot.verdicts;
  }
}
