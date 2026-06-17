/**
 * Adaptateur **gateway** des briques de résilience partagées
 * (`@creche-planner/resilience`, DEC-08). Le code (circuit breaker, retry borné,
 * `fetchAvecTimeout`) vit désormais dans la lib `type:infrastructure` partagée :
 * ce fichier n'est qu'une **réexport** conservant le point d'import historique
 * (`./resilience.js`) des clients REST de la gateway.
 *
 * Variante propre à la gateway : `executerResilient` **propage** la dernière
 * erreur (le BFF traduit ensuite l'échec amont en réponse HTTP). La variante de
 * repli (`executerOuRepli`) reste disponible mais n'est pas utilisée ici.
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
