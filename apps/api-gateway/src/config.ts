import {
  champEnv,
  estProduction,
  lireEnv,
  type RegleProduction,
  type ValeursEnv,
} from '@creche-planner/nest-commons/config';

/** Réglages du rate-limit (fenêtre glissante simple, en mémoire). */
export interface RateLimitConfig {
  /** Largeur de la fenêtre (ms). */
  readonly fenetreMs: number;
  /** Nombre maximal de requêtes autorisées par client sur la fenêtre. */
  readonly maxRequetes: number;
}

/**
 * Configuration de l'**identité parent** (option B1 — Cloudflare Access).
 *
 * En production, CF Access est au bord de la gateway et injecte un JWT signé
 * (`Cf-Access-Jwt-Assertion`). Le guard d'identité (PR5) le **valide** contre le
 * JWKS du team domain (`cfTeamDomain/cdn-cgi/access/certs`), en vérifiant
 * l'`issuer` (= team domain) et l'`aud` (= `cfAud`, tag de l'application CF).
 * On ne fait **jamais** confiance à un en-tête e-mail brut (spoofable).
 */
export interface IdentiteConfig {
  /**
   * Team domain Cloudflare Access (ex. `https://mon-equipe.cloudflareaccess.com`).
   * Sert d'issuer **et** de base d'URL du JWKS. Absent → validation JWT inactive
   * (dev / prod non exposée derrière `GATEWAY_AUTH_DISABLED=1`).
   */
  readonly cfTeamDomain: string | undefined;
  /** Tag `aud` de l'application CF Access (audience attendue du JWT). */
  readonly cfAud: string | undefined;
  /**
   * Autorise l'en-tête de dev `X-Dev-User-Email` (identité injectée sans CF).
   * **Jamais en production** : vrai uniquement si `NODE_ENV !== 'production'`.
   */
  readonly devHeaderAutorise: boolean;
}

export interface GatewayConfig {
  readonly port: number;
  readonly referentielUrl: string;
  readonly foyerUrl: string;
  readonly planificationUrl: string;
  readonly tarificationUrl: string;
  readonly notificationsUrl: string;
  /**
   * Jeton d'API attendu (auth Bearer). Si **absent**, l'authentification est
   * **désactivée** (confort de dev local). En production, cette absence doit
   * être un **choix explicite** : `REGLE_JETON_MACHINE` refuse le démarrage
   * sans jeton ni échappatoire `GATEWAY_AUTH_DISABLED=1` (AQ-01).
   *
   * Une valeur **vide ou blanche** vaut **absente** : c'est un invariant de la
   * trousse `lireEnv`, donc de la **seule** lecture qui existe désormais. Les
   * deux lectures d'avant divergeaient (AN-20) : `GATEWAY_TOKEN=""` passait le
   * garde-fou de démarrage — qui le traitait comme absent — puis armait le guard
   * sur un jeton vide, si bien que toute requête sans `Authorization: Bearer `
   * (avec l'espace) était rejetée.
   */
  readonly authToken: string | undefined;
  /**
   * Origines CORS autorisées. `['*']` (défaut) reflète toutes les origines
   * (dev) ; sinon liste blanche issue de `CORS_ORIGINS` (séparées par virgule).
   */
  readonly corsOrigins: readonly string[];
  readonly rateLimit: RateLimitConfig;
  /**
   * Nombre de **relais de confiance** entre la gateway et le client, au sens
   * `trust proxy` d'Express : combien d'adresses ignorer en partant de la droite
   * de la chaîne `[...X-Forwarded-For, pair TCP]` pour retomber sur le client.
   *
   * `0` (défaut) ⇒ aucun relais de confiance : `req.ip` est le **pair TCP**. C'est
   * le seul défaut sûr — un `X-Forwarded-For` est écrit par le client et n'est
   * digne de foi que sur les sauts qu'on a soi-même déployés.
   *
   * Le réglage se dérive de la topologie **versionnée**, pas au jugé (AN-15) :
   * - pile locale, `docker-compose.yml` — navigateur → `web` (nginx, qui pose
   *   `X-Forwarded-For`) → gateway. Chaîne vue : `[client, nginx]` ⇒ **1** ;
   * - serveur, `docker-compose.server.yml` — client → Caddy (pose
   *   `X-Forwarded-For`) → `web` (nginx, qui le complète) → gateway. Chaîne vue :
   *   `[client, caddy, nginx]` ⇒ **2**.
   *
   * Sans lui, `req.ip` valait l'adresse de nginx pour **tout** le trafic : le
   * rate-limit n'était pas par client mais une fenêtre unique partagée (AN-15).
   */
  readonly proxyHops: number;
  readonly identite: IdentiteConfig;
  /**
   * Allowlist d'e-mails **administrateurs** (option b-ii, provisioning admin).
   * Comparée à l'e-mail vérifié par Cloudflare Access pour gater la **création**
   * de foyer et la **CRUD parents** (cf. `AdminGuard`). Normalisée en minuscules.
   *
   * **Opt-in** : liste **vide** ⇒ gating admin **désactivé** (toutes les requêtes
   * passent — idiome du repo, cf. `GATEWAY_TOKEN` absent). La prod actuelle
   * (sans `ADMIN_EMAILS`) reste donc inchangée ; le 403 admin ne s'active que
   * lorsqu'un opérateur pose volontairement `ADMIN_EMAILS` (déploiement PR8).
   */
  readonly adminEmails: readonly string[];
  /**
   * **Enforcement de l'autorisation par foyer** (PR7) — `FOYER_AUTHZ_ENFORCE=1`.
   *
   * **Opt-in, désactivé par défaut** (`false`). Tant qu'il vaut `false`, le
   * `AppartenanceGuard` reste **observe-only** : il journalise « AURAIT REFUSÉ »
   * mais laisse passer (comportement legacy, prod actuelle inchangée). Posé à `1`
   * — **uniquement après le back-fill des e-mails parents (PR6)** — il transforme
   * l'observation en **refus réel (403)** sur toute route portant un `foyerId`.
   * Un mauvais réglage (activé avant back-fill) verrouillerait des foyers : à
   * n'activer en prod qu'après vérification (décision humaine, doc 24).
   */
  readonly foyerAuthzEnforce: boolean;
  /**
   * Secret HMAC signant les **assertions d'identité** propagées vers les services
   * (`ASSERTION_IDENTITE_SECRET`, chantier fondations lot 3). Partagé avec les 5
   * services. **Absent ⇒** aucun en-tête `x-assertion-identite` n'est émis (les
   * services restent en mode legacy). En prod, le compose l'exige (`${VAR:?}`).
   */
  readonly assertionSecret: string | undefined;
}

/**
 * Variables d'environnement lues par la passerelle (`AM-44`, lot 5 standards).
 * **Cette déclaration est l'inventaire** : toute variable lue ailleurs qu'ici est
 * refusée par la porte `pnpm environnement`, et toute variable posée par un
 * compose sans figurer ici est un réglage inerte.
 *
 * Les quatre bascules **fail-open** d'`AM-30` y figurent nommément
 * (`ADMIN_EMAILS`, `CF_ACCESS_*`, `FOYER_AUTHZ_ENFORCE`, plus l'échappatoire
 * `GATEWAY_AUTH_DISABLED`) : le lot les rend **visibles**, il ne les ferme pas —
 * les fermer est un geste d'exploitation, pas de code.
 *
 * ⚠️ La passerelle n'importe **pas** `CHAMPS_ASSERTION` : elle **signe** les
 * assertions, elle ne les vérifie pas, donc `INTERSERVICE_AUTHZ_ENFORCE` ne la
 * concerne pas (cf. le constat sur `docker-compose.server.yml`).
 */
export const CHAMPS_ENV = {
  PORT: champEnv.port(3000),
  REFERENTIEL_URL: champEnv.urlService('http://localhost:3001'),
  FOYER_URL: champEnv.urlService('http://localhost:3002'),
  PLANIFICATION_URL: champEnv.urlService('http://localhost:3004'),
  TARIFICATION_URL: champEnv.urlService('http://localhost:3005'),
  NOTIFICATIONS_URL: champEnv.urlService('http://localhost:3006'),
  GATEWAY_TOKEN: champEnv.secret(),
  GATEWAY_AUTH_DISABLED: champEnv.bascule(),
  CORS_ORIGINS: champEnv.liste(),
  // Fenêtre bornée à 1 h : au-delà, la fenêtre glissante en mémoire garde une
  // liste d'horodatages par client sans jamais la purger.
  RATE_LIMIT_FENETRE_MS: champEnv.entier({
    defaut: 60000,
    min: 1,
    max: 3600000,
  }),
  RATE_LIMIT_MAX: champEnv.entier({ defaut: 120, min: 1, max: 1000000 }),
  // Nombre de relais de confiance : `0` reste le défaut sûr, mais une valeur
  // illisible refuse désormais le démarrage au lieu de retomber sur `0` — un
  // repli qui rouvrait AN-15 (fenêtre de rate-limit unique) sans rien dire.
  RATE_LIMIT_PROXY_HOPS: champEnv.entier({ defaut: 0, min: 0, max: 10 }),
  CF_ACCESS_TEAM_DOMAIN: champEnv.secret(),
  CF_ACCESS_AUD: champEnv.secret(),
  ADMIN_EMAILS: champEnv.allowlist(),
  FOYER_AUTHZ_ENFORCE: champEnv.bascule(),
  ASSERTION_IDENTITE_SECRET: champEnv.secret(),
} as const;

type ValeursGateway = ValeursEnv<typeof CHAMPS_ENV>;

/**
 * Échappatoire commune aux deux règles d'auth : la prod actuelle tourne
 * volontairement sans auth (gateway non exposée — reverse-proxy + ports non
 * publiés + Cloudflare Access, décision doc 24 ; c'est
 * `docker-compose.server.yml` qui pose l'échappatoire, pas un défaut implicite).
 */
function authVolontairementDesactivee(valeurs: ValeursGateway): boolean {
  return valeurs.GATEWAY_AUTH_DISABLED;
}

/**
 * **AQ-01 (doc 27)** — `GATEWAY_TOKEN` (auth machine web→gateway) : refuse le
 * démarrage en prod sans jeton (absent ou vide) **et** sans échappatoire.
 * (Jusqu'au lot 5 : premier garde-fou de `verifierConfigProduction()`.)
 */
export const REGLE_JETON_MACHINE: RegleProduction<ValeursGateway> = {
  nom: 'jeton machine (AQ-01)',
  verifier: (valeurs) =>
    !authVolontairementDesactivee(valeurs) &&
    valeurs.GATEWAY_TOKEN === undefined
      ? "GATEWAY_TOKEN requis en production : sans lui l'authentification de la " +
        'gateway est désactivée. Pour la désactiver volontairement (gateway non ' +
        'exposée, cf. doc 24), poser GATEWAY_AUTH_DISABLED=1.'
      : undefined,
};

/**
 * **PR5 (identité B1)** — validation JWT Cloudflare Access : refuse le démarrage
 * en prod sans `CF_ACCESS_TEAM_DOMAIN` + `CF_ACCESS_AUD` **et** sans
 * échappatoire. Même philosophie que ci-dessus : faire confiance à l'e-mail
 * vérifié par CF exige d'avoir configuré contre quoi valider sa signature.
 */
export const REGLE_IDENTITE_CLOUDFLARE: RegleProduction<ValeursGateway> = {
  nom: 'identité Cloudflare Access (PR5)',
  verifier: (valeurs) =>
    !authVolontairementDesactivee(valeurs) &&
    (valeurs.CF_ACCESS_TEAM_DOMAIN === undefined ||
      valeurs.CF_ACCESS_AUD === undefined)
      ? 'CF_ACCESS_TEAM_DOMAIN et CF_ACCESS_AUD requis en production : la ' +
        'validation du JWT Cloudflare Access (option B1) ne peut vérifier ni ' +
        "l'issuer ni l'audience sans eux. Pour démarrer sans identité CF " +
        '(gateway non exposée, cf. doc 24), poser GATEWAY_AUTH_DISABLED=1.'
      : undefined,
};

/**
 * Configuration de la gateway, **validée** au premier appel (donc au démarrage :
 * `main.ts` l'appelle en première instruction). Une variable illisible refuse le
 * démarrage en nommant le champ, au lieu de propager un `NaN` — `RATE_LIMIT_MAX`
 * non numérique **désactivait le rate-limit en silence** (`hits >= NaN` est
 * toujours faux).
 */
export function loadConfig(
  env: Record<string, string | undefined> = process.env,
): GatewayConfig {
  const valeurs = lireEnv('api-gateway', CHAMPS_ENV, {
    env,
    regles: [REGLE_JETON_MACHINE, REGLE_IDENTITE_CLOUDFLARE],
  });
  return {
    port: valeurs.PORT,
    referentielUrl: valeurs.REFERENTIEL_URL,
    foyerUrl: valeurs.FOYER_URL,
    planificationUrl: valeurs.PLANIFICATION_URL,
    tarificationUrl: valeurs.TARIFICATION_URL,
    notificationsUrl: valeurs.NOTIFICATIONS_URL,
    authToken: valeurs.GATEWAY_TOKEN,
    corsOrigins: valeurs.CORS_ORIGINS.length > 0 ? valeurs.CORS_ORIGINS : ['*'],
    rateLimit: {
      fenetreMs: valeurs.RATE_LIMIT_FENETRE_MS,
      maxRequetes: valeurs.RATE_LIMIT_MAX,
    },
    proxyHops: valeurs.RATE_LIMIT_PROXY_HOPS,
    identite: {
      cfTeamDomain: valeurs.CF_ACCESS_TEAM_DOMAIN,
      cfAud: valeurs.CF_ACCESS_AUD,
      devHeaderAutorise: !estProduction(valeurs),
    },
    adminEmails: valeurs.ADMIN_EMAILS,
    foyerAuthzEnforce: valeurs.FOYER_AUTHZ_ENFORCE,
    assertionSecret: valeurs.ASSERTION_IDENTITE_SECRET,
  };
}
