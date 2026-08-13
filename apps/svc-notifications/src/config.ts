import {
  champEnv,
  CHAMPS_ASSERTION,
  configAssertion,
  lireEnv,
  type ConfigAssertion,
  type RegleProduction,
  type ValeursEnv,
} from '@creche-planner/nest-commons';

/**
 * Configuration e-mail du service. L'envoi vers un tiers réel est un effet de bord à
 * **isoler, tracer et pouvoir couper** : `dryRun` vaut **true par défaut** (on ne
 * spamme pas une vraie crèche) et n'est désactivé que par un `NOTIF_EMAIL_DRY_RUN`
 * **explicitement** `false` (forme `champEnv.basculeExtinction` : un garde-fou ne se
 * lève que sur un mot exact). L'`allowlist`, si renseignée, redirige tout
 * destinataire hors-prod.
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
 *
 * ⚠️ Cette règle est **métier**, pas syntaxique : un `champEnv.urlService()` (donc
 * un `z.url()`) accepterait `http://192.168.1.129` sans broncher. Elle reste donc
 * une règle de production explicite, jamais remplacée par la validation de forme.
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
 * Variables d'environnement lues par ce service (`AM-44`, lot 5 standards).
 * **Cette déclaration est l'inventaire** : toute variable lue ailleurs qu'ici est
 * refusée par la porte `pnpm environnement`, et toute variable posée par un
 * compose sans figurer ici est un réglage inerte.
 */
export const CHAMPS_ENV = {
  PORT: champEnv.port(3006),
  DATABASE_URL: champEnv.urlPostgres(
    'postgres://notifications:notifications@localhost:5437/notifications',
  ),
  NATS_URL: champEnv.urlNats('nats://localhost:4222'),
  PLANIFICATION_URL: champEnv.urlService('http://localhost:3004'),
  FOYER_URL: champEnv.urlService('http://localhost:3002'),
  // Les deux URL des liens d'e-mail : la **forme** est validée ici (URL absolue),
  // la règle **métier** (https + domaine public) est
  // `REGLE_URLS_LIENS_EMAIL` ci-dessous. Leur repli de dev vise `localhost`, donc
  // la trousse refuse déjà le démarrage en production si elles ne sont pas posées.
  NOTIF_APP_URL: champEnv.urlService('http://localhost:4200'),
  NOTIF_PUBLIC_API_URL: champEnv.urlService('http://localhost:3000'),
  NOTIF_UNSUBSCRIBE_MAILTO: champEnv.texte(''),
  NOTIF_SCHEDULER_HEURE: champEnv.entier({ defaut: 8, min: 0, max: 23 }),
  NOTIF_SCHEDULER_FORCER: champEnv.bascule(),
  SMTP_HOST: champEnv.texte('smtp.gmail.com'),
  SMTP_PORT: champEnv.port(587),
  SMTP_USER: champEnv.texte(''),
  SMTP_PASSWORD: champEnv.secretAvecRepli(''),
  NOTIF_EMAIL_FROM: champEnv.texte(
    'Crèche Planner <ne-pas-repondre@example.org>',
  ),
  NOTIF_EMAIL_PARENT: champEnv.texte('edouard.zemb@gmail.com'),
  // Garde-fou : dry-run par défaut, levé seulement par un `false` explicite.
  NOTIF_EMAIL_DRY_RUN: champEnv.basculeExtinction('false'),
  NOTIF_EMAIL_ALLOWLIST: champEnv.liste(),
  ...CHAMPS_ASSERTION,
} as const;

/**
 * Garde-fou de démarrage (jusqu'au lot 5 : `verifierConfigProduction()`, l'un des
 * trois homonymes du dépôt) : en **production**, les URL de base insérées dans les
 * liens des e-mails de rappel — `NOTIF_APP_URL` (lien « valider mon planning ») et
 * `NOTIF_PUBLIC_API_URL` (cible one-click `List-Unsubscribe`) — doivent être des
 * URL **https à nom de domaine public**. Réglées sur l'IP LAN du serveur (défaut
 * historique via `SERVER_ORIGIN`), les liens sont **injoignables hors-LAN** et
 * **à certificat invalide** pour le parent : le service **refuse de démarrer**
 * pour rendre cette mauvaise configuration bruyante plutôt que silencieuse.
 *
 * Hors production (dev / test / e2e local avec `http://localhost:*`), la règle est
 * **inactive** — `lireEnv` ne joue les règles qu'en production.
 */
export const REGLE_URLS_LIENS_EMAIL: RegleProduction<
  ValeursEnv<typeof CHAMPS_ENV>
> = {
  nom: "URL des liens d'e-mail",
  verifier: (valeurs) => {
    const candidates: readonly (readonly [string, string])[] = [
      ['NOTIF_APP_URL', valeurs.NOTIF_APP_URL],
      ['NOTIF_PUBLIC_API_URL', valeurs.NOTIF_PUBLIC_API_URL],
    ];
    const invalides = candidates.filter(([, url]) => !estUrlEmailPublique(url));
    if (invalides.length === 0) {
      return undefined;
    }
    return (
      'NOTIF_APP_URL/NOTIF_PUBLIC_API_URL doit être une URL https à nom de ' +
      'domaine public (pas une IP ni localhost) : sinon les liens des e-mails ' +
      'de rappel sont injoignables ou à certificat invalide pour les parents. ' +
      `Valeur(s) reçue(s) : ${invalides.map(([nom, url]) => `${nom}=${url}`).join(', ')}.`
    );
  },
};

/**
 * Configuration du service, **validée** au premier appel (donc au démarrage :
 * `main.ts` l'appelle en première instruction). Une variable illisible refuse le
 * démarrage en nommant le champ, au lieu de propager un `NaN` ou un repli
 * `localhost` jusqu'à la première requête.
 */
export function loadConfig(
  env: Record<string, string | undefined> = process.env,
): ServiceConfig {
  const valeurs = lireEnv('svc-notifications', CHAMPS_ENV, {
    env,
    regles: [REGLE_URLS_LIENS_EMAIL],
  });
  return {
    port: valeurs.PORT,
    databaseUrl: valeurs.DATABASE_URL,
    natsUrl: valeurs.NATS_URL,
    planificationUrl: valeurs.PLANIFICATION_URL,
    foyerUrl: valeurs.FOYER_URL,
    appUrl: valeurs.NOTIF_APP_URL,
    publicApiUrl: valeurs.NOTIF_PUBLIC_API_URL,
    unsubscribeMailto: valeurs.NOTIF_UNSUBSCRIBE_MAILTO,
    schedulerHeure: valeurs.NOTIF_SCHEDULER_HEURE,
    schedulerForcer: valeurs.NOTIF_SCHEDULER_FORCER,
    email: {
      host: valeurs.SMTP_HOST,
      port: valeurs.SMTP_PORT,
      user: valeurs.SMTP_USER,
      password: valeurs.SMTP_PASSWORD,
      from: valeurs.NOTIF_EMAIL_FROM,
      parent: valeurs.NOTIF_EMAIL_PARENT,
      dryRun: valeurs.NOTIF_EMAIL_DRY_RUN,
      allowlist: valeurs.NOTIF_EMAIL_ALLOWLIST,
    },
    assertion: configAssertion(valeurs),
  };
}
