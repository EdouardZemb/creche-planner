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
 * Compteur du **couplage runtime résiduel assumé** (DEC-05, ADR-0004) : nombre de
 * fois où `svc-tarification` a dû interroger `svc-planification` en HTTP synchrone
 * faute de read model chaud. On ne supprime pas ce repli — on le **mesure** pour
 * vérifier qu'il reste exceptionnel (cf. `docs/exploitation/observabilite.md`).
 *
 * Métrique OTel exportée en Prometheus sous le nom `tarification_repli_planification_total`.
 * Si aucun MeterProvider n'est enregistré (SDK métriques non câblé), l'API OTel est
 * un no-op silencieux : le code reste sûr et sans effet de bord fonctionnel (CA3).
 */
const meter = metrics.getMeter('svc-tarification.fallback');
const compteurRepliPlanification = meter.createCounter(
  'tarification_repli_planification_total',
  {
    description:
      'Nombre de replis synchrones tarif→planif (read model froid). Doit rester exceptionnel.',
  },
);

/**
 * Forme sérialisée d'une prestation du mois renvoyée par `svc-planification`
 * (`GET /api/prestations`). La crèche expose des durées en **minutes** (entiers) ;
 * les modes ABCM exposent des quantités. On valide a minima le `mode` et on
 * conserve le reste (`passthrough`) pour le mapper côté domaine Tarification.
 */
const prestationSchema = z
  .object({
    mode: z.enum(['CRECHE_PSU', 'CANTINE', 'PERISCOLAIRE', 'ALSH']),
  })
  .passthrough();

const prestationsReponseSchema = z.object({
  contratId: z.string(),
  mois: z.string(),
  simule: z.boolean(),
  prestations: z.array(prestationSchema),
});

/** Prestations d'un contrat pour un mois (quantités, sans montant). */
export type PrestationsContratFallback = z.infer<
  typeof prestationsReponseSchema
>;

const OPTIONS: OptionsResilience = {
  timeoutMs: 2000,
  retries: 1,
  delaiEntreEssaisMs: 200,
};

/**
 * Client de **repli synchrone** vers `svc-planification`. Sert dans deux cas :
 *  1. à l'**enrichissement** du read model par le consommateur d'événements (les
 *     events `PlanningModifie`/`ContratCree` ne portent pas les quantités, juste
 *     l'identité — on va donc chercher les prestations générées) ;
 *  2. en **repli** quand le read model est froid pour un (contrat, mois).
 *
 * Timeout + retry borné + circuit-breaker. En cas d'échec total, renvoie
 * `undefined` (dégradation propre).
 */
@Injectable()
export class PlanificationClient {
  private readonly logger = new Logger(PlanificationClient.name);
  private readonly breaker = new CircuitBreaker();

  async prestations(
    contratId: string,
    mois: string,
    simule: boolean,
  ): Promise<PrestationsContratFallback | undefined> {
    // DEC-05/CA1 : tout appel à cette méthode est un usage effectif du repli
    // synchrone (le read model est froid pour ce contrat/mois). On l'incrémente
    // ici, avant l'appel réseau, pour mesurer la **fréquence du repli** quel que
    // soit son issue (succès, dégradation ou circuit ouvert). La condition de
    // déclenchement n'est PAS modifiée (CA3) : on n'ajoute qu'une mesure.
    compteurRepliPlanification.add(1, { simule });

    const base = loadConfig().planificationUrl;
    const url =
      `${base}/api/prestations?contrat=${encodeURIComponent(contratId)}` +
      `&mois=${encodeURIComponent(mois)}&simule=${simule ? 'true' : 'false'}`;
    return executerOuRepli<PrestationsContratFallback | undefined>(
      'svc-planification',
      async () => {
        const reponse = await fetchAvecTimeout(url, OPTIONS.timeoutMs);
        if (!reponse.ok) {
          throw new Error(`HTTP ${reponse.status}`);
        }
        return prestationsReponseSchema.parse(await reponse.json());
      },
      undefined,
      this.breaker,
      OPTIONS,
      this.logger,
    );
  }
}
