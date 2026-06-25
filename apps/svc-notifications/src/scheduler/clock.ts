/**
 * Horloge **injectable**. Le scheduler du mardi ne doit jamais appeler `new Date()`
 * directement : tout son raisonnement temporel (« est-on mardi à/au-delà de l'heure
 * de déclenchement, en Europe/Paris ? ») passe par ce port, mocké dans les tests pour
 * pousser un instant précis sans dépendre de l'horloge réelle ni du fuseau du serveur.
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
