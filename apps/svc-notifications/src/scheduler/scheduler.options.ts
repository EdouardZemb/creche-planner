export const OPTIONS_SCHEDULER = Symbol('OPTIONS_SCHEDULER');

/**
 * Points de variance du scheduler hebdomadaire, fournis par le service depuis sa
 * configuration. Séparés du `MailerService` (qui porte ses propres garde-fous
 * dry-run/allowlist) : ces options ne décident **que** du quand (heure de
 * déclenchement) et du quoi (destinataire parent du récap, lien profond du front).
 */
export interface OptionsScheduler {
  /** Heure de déclenchement le mardi, exprimée en `Europe/Paris` (0-23). */
  readonly heureDeclenchement: number;
  /**
   * **Environnements de test uniquement** (`NOTIF_SCHEDULER_FORCER=1`) : ignore la
   * fenêtre « mardi ≥ heure » et déclenche dès le boot puis à chaque tick. Rend le
   * parcours notification → validation exerçable de façon déterministe par les e2e
   * stack (sinon la ligne `notification_hebdo` n'existe que si la pile a démarré un
   * mardi). Jamais posé en prod : le jour métier reste le mardi.
   */
  readonly forcerFenetre: boolean;
  /** Adresse du parent destinataire du mail récapitulatif. */
  readonly emailParent: string;
  /** URL publique du front, base du lien « valider » et du lien de désabonnement. */
  readonly appUrl: string;
  /**
   * Base publique de l'API gateway : cible de l'en-tête one-click `List-Unsubscribe`
   * (`${publicApiUrl}/api/v1/desabonnement?token=…`, RFC 8058, PR5).
   */
  readonly publicApiUrl: string;
  /** Adresse `mailto:` de repli du désabonnement (vide ⇒ seul le lien HTTPS est publié). */
  readonly unsubscribeMailto: string;
}
