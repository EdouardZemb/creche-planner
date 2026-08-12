/**
 * Horloge **injectable**, mutualisée. Aucun traitement périodique ne doit appeler
 * `new Date()` directement : tout raisonnement temporel (« est-on mardi à/au-delà de
 * l'heure de déclenchement, en Europe/Paris ? », « quelle est la borne de rétention ? »)
 * passe par ce port, mocké dans les tests pour pousser un instant précis sans dépendre
 * de l'horloge réelle ni du fuseau du serveur.
 *
 * Remontée ici depuis `apps/svc-notifications/src/scheduler/clock.ts` au lot 2b : le
 * scheduler du mardi n'était pas le seul à en avoir besoin, et le patron partagé de
 * tâche périodique (`OutboxRelay`) était justement celui **sans** horloge — il appelait
 * `new Date()` en dur, donc son comportement temporel n'était pas prouvable.
 */
export const CLOCK = Symbol('CLOCK');

/** Source de l'instant courant (seul `horlogeSysteme` appelle réellement `new Date`). */
export interface Clock {
  maintenant(): Date;
}

/** Implémentation par défaut (production) : l'instant système. */
export const horlogeSysteme: Clock = {
  maintenant: () => new Date(),
};
