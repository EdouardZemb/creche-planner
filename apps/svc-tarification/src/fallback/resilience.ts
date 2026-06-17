/**
 * Adaptateur **tarification** des briques de résilience partagées
 * (`@creche-planner/resilience`, DEC-08). Le code (circuit breaker, retry borné,
 * `fetchAvecTimeout`) vit désormais dans la lib `type:infrastructure` partagée :
 * ce fichier n'est qu'une **réexport** conservant le point d'import historique
 * (`./resilience.js`) des clients de repli synchrone.
 *
 * Variante propre à la tarification : `executerOuRepli` applique une
 * **dégradation propre** (journalise et renvoie un repli) pour que l'endpoint
 * coût ne plante jamais sur une dépendance amont injoignable. `executerResilient`
 * reste disponible (utilisé en interne par `executerOuRepli`).
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
