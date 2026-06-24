export const OPTIONS_MAILER = Symbol('OPTIONS_MAILER');

/**
 * Points de variance du module e-mail applicatif, fournis par le service.
 *
 * L'envoi vers un tiers réel est un effet de bord à **isoler, tracer et pouvoir
 * couper** (cf. plan « Notifications ») : `dryRun` et `allowlist` sont des
 * garde-fous de premier ordre, pas des détails de configuration.
 */
export interface OptionsMailer {
  /** Hôte SMTP (ex. `smtp.gmail.com`). */
  host: string;
  /** Port SMTP (ex. `587`). */
  port: number;
  /** Identifiant SMTP (compte expéditeur). */
  user: string;
  /**
   * Mot de passe SMTP, résolu paresseusement : le secret n'est lu qu'au moment
   * de l'envoi (jamais figé à l'instanciation du module).
   */
  passwordProvider: () => string;
  /** En-tête `From` des messages émis. */
  from: string;
  /**
   * Mode bac à sable : si `true`, **aucun** transport SMTP n'est sollicité.
   * Défaut attendu hors-prod (on ne spamme pas une vraie crèche).
   */
  dryRun: boolean;
  /**
   * Liste blanche de destinataires autorisés. **Si non vide**, tout `to` absent
   * de la liste est bloqué (traité comme un dry-run). Vide ⇒ aucun filtrage.
   */
  allowlist: readonly string[];
}
