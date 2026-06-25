/**
 * Adaptateur **notifications** des briques de résilience partagées
 * (`@creche-planner/resilience`). Le code (circuit breaker, retry borné,
 * `fetchAvecTimeout`) vit dans la lib `type:infrastructure` partagée ; ce fichier
 * n'est qu'une **réexport** conservant le point d'import local (`./resilience.js`)
 * du client de relecture du planning.
 *
 * `executerOuRepli` applique une **dégradation propre** (journalise et renvoie un
 * repli) : si `svc-planification` est injoignable, la relecture du planning ne plante
 * pas la validation — elle se contente de conserver le snapshot (cf.
 * `planification.client.ts`).
 */
export {
  CircuitBreaker,
  CircuitOuvertError,
  fetchAvecTimeout,
  executerResilient,
  executerOuRepli,
} from '@creche-planner/resilience';
export type {
  OptionsResilience,
  EtatCircuit,
} from '@creche-planner/resilience';
