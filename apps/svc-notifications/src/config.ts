/**
 * Configuration e-mail du service. L'envoi vers un tiers réel est un effet de bord à
 * **isoler, tracer et pouvoir couper** : `dryRun` vaut **true par défaut** (on ne
 * spamme pas une vraie crèche) et n'est désactivé que par un `NOTIF_EMAIL_DRY_RUN`
 * **explicitement** `false` (même philosophie de garde-fou que `verifierConfigProduction`
 * côté gateway). L'`allowlist`, si renseignée, redirige tout destinataire hors-prod.
 */
export interface EmailConfig {
  readonly host: string;
  readonly port: number;
  readonly user: string;
  readonly password: string;
  readonly from: string;
  /**
   * **DÉPRÉCIÉ** — adresse globale **de repli** du récap du mardi (`NOTIF_EMAIL_PARENT`).
   *
   * (Marqueur de prose volontaire, **sans** balise `@deprecated` : le champ reste
   * activement — et légitimement — lu comme repli, on ne veut pas que chaque lecture
   * sanctionnée déclenche la règle lint `no-deprecated`.)
   *
   * Depuis la feature « parents du foyer » (PR4), le récap est adressé aux **parents
   * actifs du foyer** concerné (projection NATS `foyer_parent`, cf.
   * `DestinatairesService`). Cette adresse n'est utilisée qu'en **repli**, et
   * **uniquement** si un foyer notifié n'a encore **aucun** parent avec e-mail — auquel
   * cas le scheduler journalise aussi un `warn` (cf. `scheduler.hebdo.ts`).
   *
   * **Chemin de migration / retrait** : peupler les parents de **tous** les foyers
   * (écran web admin, ou `scripts/backfill-parents.mjs`), vérifier qu'aucun `warn`
   * « repli NOTIF_EMAIL_PARENT » n'apparaît plus sur un cycle hebdo, **puis** retirer la
   * variable de `.env.server(.enc)` et ce champ. Conservée tant que la couverture
   * parents n'est pas totale, pour ne perdre aucun envoi.
   */
  readonly parent: string;
  /** Bac à sable : si `true`, aucun transport SMTP n'est sollicité (défaut). */
  readonly dryRun: boolean;
  /** Liste blanche de destinataires (vide ⇒ aucun filtrage). */
  readonly allowlist: readonly string[];
}

export interface ServiceConfig {
  readonly port: number;
  readonly databaseUrl: string;
  readonly natsUrl: string;
  /** Base URL de `svc-planification` (relecture du planning pour le diff de validation). */
  readonly planificationUrl: string;
  /** Base URL de `svc-foyer` (émission des jetons de désabonnement one-click, PR5). */
  readonly foyerUrl: string;
  /** URL publique du front : base du lien « valider » inséré dans les mails récap. */
  readonly appUrl: string;
  /**
   * Base publique de l'**API gateway** (origine) : cible de l'en-tête one-click
   * `List-Unsubscribe` (`${publicApiUrl}/api/v1/desabonnement?token=…`, POST direct
   * du client de messagerie, RFC 8058). En prod, même origine que le front.
   */
  readonly publicApiUrl: string;
  /**
   * Adresse `mailto:` de repli du désabonnement (RFC 8058 recommande une seconde
   * option à l'en-tête `List-Unsubscribe`). Vide ⇒ seul le lien HTTPS one-click
   * est publié (suffisant pour la conformité one-click).
   */
  readonly unsubscribeMailto: string;
  /** Heure de déclenchement du scheduler du mardi, exprimée en `Europe/Paris` (0-23). */
  readonly schedulerHeure: number;
  readonly email: EmailConfig;
}

/** Découpe une liste CSV « a, b ,c » en tableau nettoyé. */
function parseListe(valeur: string | undefined): string[] {
  return (valeur ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

/** Configuration du service depuis l'environnement, avec des défauts de dev local. */
export function loadConfig(): ServiceConfig {
  return {
    port: Number(process.env['PORT'] ?? 3006),
    databaseUrl:
      process.env['DATABASE_URL'] ??
      'postgres://notifications:notifications@localhost:5437/notifications',
    natsUrl: process.env['NATS_URL'] ?? 'nats://localhost:4222',
    planificationUrl:
      process.env['PLANIFICATION_URL'] ?? 'http://localhost:3004',
    foyerUrl: process.env['FOYER_URL'] ?? 'http://localhost:3002',
    appUrl: process.env['NOTIF_APP_URL'] ?? 'http://localhost:4200',
    publicApiUrl:
      process.env['NOTIF_PUBLIC_API_URL'] ?? 'http://localhost:3000',
    unsubscribeMailto: process.env['NOTIF_UNSUBSCRIBE_MAILTO'] ?? '',
    schedulerHeure: Number(process.env['NOTIF_SCHEDULER_HEURE'] ?? 8),
    email: {
      host: process.env['SMTP_HOST'] ?? 'smtp.gmail.com',
      port: Number(process.env['SMTP_PORT'] ?? 587),
      user: process.env['SMTP_USER'] ?? '',
      password: process.env['SMTP_PASSWORD'] ?? '',
      from:
        process.env['NOTIF_EMAIL_FROM'] ??
        'Crèche Planner <ne-pas-repondre@example.org>',
      parent: process.env['NOTIF_EMAIL_PARENT'] ?? 'edouard.zemb@gmail.com',
      // Garde-fou : dry-run par défaut, désactivé seulement par un `false` explicite.
      dryRun: process.env['NOTIF_EMAIL_DRY_RUN'] !== 'false',
      allowlist: parseListe(process.env['NOTIF_EMAIL_ALLOWLIST']),
    },
  };
}
