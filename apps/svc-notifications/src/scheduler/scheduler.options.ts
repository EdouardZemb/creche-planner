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
  /** Adresse du parent destinataire du mail récapitulatif. */
  readonly emailParent: string;
  /** URL publique du front, base du lien « valider » inséré dans le mail. */
  readonly appUrl: string;
}
