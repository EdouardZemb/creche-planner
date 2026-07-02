import { Injectable, Logger } from '@nestjs/common';
import { metrics } from '@opentelemetry/api';
import { z } from 'zod';
import { loadConfig } from '../config.js';
import {
  CircuitBreaker,
  executerOuRepli,
  fetchAvecTimeout,
  type OptionsResilience,
} from '@creche-planner/resilience';

/**
 * Compteur des relectures de planning faites par `svc-notifications` vers
 * `svc-planification` (couplage runtime résiduel, même esprit que la tarification).
 * La validation hebdomadaire relit le planning du/des mois recouverts par la semaine
 * pour calculer le `delta_modifs` ; on mesure cet appel pour vérifier qu'il reste
 * borné. Si aucun MeterProvider n'est câblé, l'API OTel est un no-op silencieux.
 */
const meter = metrics.getMeter('svc-notifications.fallback');
const compteurRelecturePlanification = meter.createCounter(
  'notifications_relecture_planification_total',
  {
    description:
      'Nombre de relectures de planning notif→planif (diff de validation hebdo).',
  },
);

/**
 * Réponse de `GET /api/contrats/:id/plannings/:mois` : la saisie enregistrée du
 * mois (forme libre — paramètres mensuels du planning) ou `null` si aucune saisie.
 */
const lirePlanningReponseSchema = z.object({
  saisie: z.record(z.string(), z.unknown()).nullable(),
});

/**
 * Résultat d'une relecture mensuelle :
 *  - un objet : la saisie du mois ;
 *  - `null` : pas de saisie pour ce mois (réponse serveur explicite) ;
 *  - `undefined` : relecture **indisponible** (planification injoignable / dégradée)
 *    — à distinguer de « pas de saisie » par l'appelant pour ne pas conclure à tort
 *    qu'un planning a été vidé.
 */
export type SaisieMois = Record<string, unknown> | null | undefined;

const OPTIONS: OptionsResilience = {
  timeoutMs: 2000,
  retries: 1,
  delaiEntreEssaisMs: 200,
};

/**
 * Client de **relecture du planning** vers `svc-planification`. Cloné du repli
 * synchrone de `svc-tarification` (`apps/svc-tarification/src/fallback/planification.client.ts`) :
 * timeout + retry borné + circuit-breaker. En cas d'échec total, renvoie `undefined`
 * (dégradation propre) plutôt que de propager — la validation conserve alors le
 * snapshot existant au lieu de planter.
 */
@Injectable()
export class PlanificationClient {
  private readonly logger = new Logger(PlanificationClient.name);
  private readonly breaker = new CircuitBreaker();

  /** Lit la saisie **réelle** d'un mois (le simulé ne concerne pas la validation). */
  async lirePlanning(contratId: string, mois: string): Promise<SaisieMois> {
    compteurRelecturePlanification.add(1);
    const base = loadConfig().planificationUrl;
    const url =
      `${base}/api/contrats/${encodeURIComponent(contratId)}` +
      `/plannings/${encodeURIComponent(mois)}?simule=false`;
    return executerOuRepli<SaisieMois>(
      'svc-planification',
      async () => {
        const reponse = await fetchAvecTimeout(url, OPTIONS.timeoutMs);
        if (!reponse.ok) {
          throw new Error(`HTTP ${reponse.status}`);
        }
        return lirePlanningReponseSchema.parse(await reponse.json()).saisie;
      },
      undefined,
      this.breaker,
      OPTIONS,
      this.logger,
    );
  }
}
