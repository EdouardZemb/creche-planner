import {
  lireConfigAssertion,
  type ConfigAssertion,
} from '@creche-planner/nest-commons';

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
  /** Test uniquement (`NOTIF_SCHEDULER_FORCER=1`) : ignore la fenêtre du mardi. */
  readonly schedulerForcer: boolean;
  readonly email: EmailConfig;
  /** Assertion d'identité inter-services (secret + enforce) — fondations lot 3. */
  readonly assertion: ConfigAssertion;
}

/** Découpe une liste CSV « a, b ,c » en tableau nettoyé. */
function parseListe(valeur: string | undefined): string[] {
  return (valeur ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

/**
 * Une URL de **base** est acceptable pour les liens d'e-mail (récap du mardi,
 * désabonnement one-click) seulement si un parent **hors réseau local** peut
 * l'ouvrir sans avertissement de certificat. Elle doit donc :
 *
 * 1. se **parser** proprement (`new URL`),
 * 2. être en **`https:`** (un lien `http:` casse la cible one-click et n'est pas
 *    fiable pour un client de messagerie),
 * 3. viser un **nom de domaine public** — jamais un littéral IP (IPv4 ou IPv6,
 *    typiquement l'IP LAN `192.168.1.129` du serveur, à certificat non fiable et
 *    injoignable hors-LAN) ni `localhost`.
 *
 * Limite connue et **assumée** : un domaine interne non public (`creche.lan`)
 * passe ce filtre — c'est l'**action ops** (poser la bonne origine publique dans
 * `.env.server.enc`) qui garantit le bon domaine ; ce garde-fou est le **filet**,
 * pas le correctif. Parsing via `URL` natif, aucune dépendance IP.
 */
export function estUrlEmailPublique(url: string): boolean {
  let parsee: URL;
  try {
    parsee = new URL(url);
  } catch {
    return false;
  }
  if (parsee.protocol !== 'https:') {
    return false;
  }
  const hote = parsee.hostname;
  if (hote === 'localhost') {
    return false;
  }
  // IPv6 littéral : `new URL` conserve les crochets, le hostname contient « : ».
  if (hote.includes(':')) {
    return false;
  }
  // IPv4 littéral : quatre octets pointés (ex. 192.168.1.129).
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(hote)) {
    return false;
  }
  return true;
}

/**
 * Garde-fou de démarrage (miroir de `verifierConfigProduction` côté api-gateway
 * et svc-foyer) : en **production**, les URL de base insérées dans les liens des
 * e-mails de rappel — `NOTIF_APP_URL` (lien « valider mon planning ») et
 * `NOTIF_PUBLIC_API_URL` (cible one-click `List-Unsubscribe`) — doivent être des
 * URL **https à nom de domaine public**. Réglées sur l'IP LAN du serveur (défaut
 * historique via `SERVER_ORIGIN`), les liens sont **injoignables hors-LAN** et
 * **à certificat invalide** pour le parent : le service **refuse de démarrer**
 * pour rendre cette mauvaise configuration bruyante plutôt que silencieuse.
 *
 * Hors production (dev / test / e2e local avec `http://localhost:*`), le
 * garde-fou est **inactif** : la validation ne s'applique qu'à `NODE_ENV`
 * production. Fonction **pure** (ni log ni effet de bord) : le bootstrap
 * (`main.ts`) journalise avant de propager le `throw`.
 */
export function verifierConfigProduction(
  config: Pick<ServiceConfig, 'appUrl' | 'publicApiUrl'>,
  env: Record<string, string | undefined> = process.env,
): void {
  if (env['NODE_ENV'] !== 'production') {
    return;
  }
  const invalides: string[] = [];
  if (!estUrlEmailPublique(config.appUrl)) {
    invalides.push(`NOTIF_APP_URL=${config.appUrl}`);
  }
  if (!estUrlEmailPublique(config.publicApiUrl)) {
    invalides.push(`NOTIF_PUBLIC_API_URL=${config.publicApiUrl}`);
  }
  if (invalides.length > 0) {
    throw new Error(
      'NOTIF_APP_URL/NOTIF_PUBLIC_API_URL doit être une URL https à nom de ' +
        'domaine public (pas une IP ni localhost) : sinon les liens des e-mails ' +
        'de rappel sont injoignables ou à certificat invalide pour les parents. ' +
        `Valeur(s) reçue(s) : ${invalides.join(', ')}.`,
    );
  }
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
    // Test uniquement (e2e stack) : ignore la fenêtre « mardi ≥ heure ».
    schedulerForcer: process.env['NOTIF_SCHEDULER_FORCER'] === '1',
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
    assertion: lireConfigAssertion(),
  };
}
