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
   * être un **choix explicite** : `verifierConfigProduction()` refuse le
   * démarrage sans jeton ni échappatoire `GATEWAY_AUTH_DISABLED=1` (AQ-01).
   */
  readonly authToken: string | undefined;
  /**
   * Origines CORS autorisées. `['*']` (défaut) reflète toutes les origines
   * (dev) ; sinon liste blanche issue de `CORS_ORIGINS` (séparées par virgule).
   */
  readonly corsOrigins: readonly string[];
  readonly rateLimit: RateLimitConfig;
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
}

/** Normalise une variable d'env : trim, et chaîne vide/blanche → `undefined`. */
function texteNonVide(valeur: string | undefined): string | undefined {
  const t = valeur?.trim();
  return t !== undefined && t !== '' ? t : undefined;
}

/** Découpe une liste d'environnement « a,b ,c » en tableau nettoyé. */
function parseListe(valeur: string | undefined): string[] {
  return (valeur ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

/** Parse l'allowlist `ADMIN_EMAILS` : minuscules, dédoublonnée, ordre stable. */
function parseAdminEmails(valeur: string | undefined): string[] {
  const vus = new Set<string>();
  for (const brut of parseListe(valeur)) {
    vus.add(brut.toLowerCase());
  }
  return [...vus];
}

/**
 * Garde-fou de démarrage : en production, deux configs d'auth doivent être des
 * **choix explicites**, jamais des oublis. L'échappatoire commune est
 * `GATEWAY_AUTH_DISABLED=1` (la prod actuelle tourne volontairement sans auth :
 * gateway non exposée — reverse-proxy + ports non publiés + Cloudflare Access,
 * décision doc 24 ; c'est l'override `docker-compose.server.yml` qui pose
 * l'échappatoire, pas un défaut implicite).
 *
 * 1. **AQ-01 (doc 27)** — `GATEWAY_TOKEN` (auth machine web→gateway) : lève si
 *    prod sans jeton (absent ou vide) **et** sans `GATEWAY_AUTH_DISABLED=1`.
 * 2. **PR5 (identité B1)** — validation JWT Cloudflare Access : lève si prod
 *    sans `CF_ACCESS_TEAM_DOMAIN` + `CF_ACCESS_AUD` **et** sans
 *    `GATEWAY_AUTH_DISABLED=1`. Même philosophie : faire confiance à l'email
 *    vérifié par CF exige d'avoir configuré contre quoi valider sa signature.
 */
export function verifierConfigProduction(
  env: Record<string, string | undefined> = process.env,
): void {
  if (env['NODE_ENV'] !== 'production') {
    return;
  }
  // Échappatoire unique : auth volontairement désactivée (gateway non exposée).
  if (env['GATEWAY_AUTH_DISABLED'] === '1') {
    return;
  }
  // Garde-fou 1 — jeton machine (AQ-01).
  const jeton = env['GATEWAY_TOKEN']?.trim();
  if (jeton === undefined || jeton === '') {
    throw new Error(
      "GATEWAY_TOKEN requis en production : sans lui l'authentification de la " +
        'gateway est désactivée. Pour la désactiver volontairement (gateway non ' +
        'exposée, cf. doc 24), poser GATEWAY_AUTH_DISABLED=1.',
    );
  }
  // Garde-fou 2 — identité Cloudflare Access (PR5).
  const teamDomain = env['CF_ACCESS_TEAM_DOMAIN']?.trim();
  const aud = env['CF_ACCESS_AUD']?.trim();
  if (!teamDomain || !aud) {
    throw new Error(
      'CF_ACCESS_TEAM_DOMAIN et CF_ACCESS_AUD requis en production : la ' +
        'validation du JWT Cloudflare Access (option B1) ne peut vérifier ni ' +
        "l'issuer ni l'audience sans eux. Pour démarrer sans identité CF " +
        '(gateway non exposée, cf. doc 24), poser GATEWAY_AUTH_DISABLED=1.',
    );
  }
}

/** Configuration de la gateway depuis l'environnement, avec défauts de dev local. */
export function loadConfig(): GatewayConfig {
  const origins = parseListe(process.env['CORS_ORIGINS']);
  return {
    port: Number(process.env['PORT'] ?? 3000),
    referentielUrl: process.env['REFERENTIEL_URL'] ?? 'http://localhost:3001',
    foyerUrl: process.env['FOYER_URL'] ?? 'http://localhost:3002',
    planificationUrl:
      process.env['PLANIFICATION_URL'] ?? 'http://localhost:3004',
    tarificationUrl: process.env['TARIFICATION_URL'] ?? 'http://localhost:3005',
    notificationsUrl:
      process.env['NOTIFICATIONS_URL'] ?? 'http://localhost:3006',
    authToken: process.env['GATEWAY_TOKEN'] ?? undefined,
    corsOrigins: origins.length > 0 ? origins : ['*'],
    rateLimit: {
      fenetreMs: Number(process.env['RATE_LIMIT_FENETRE_MS'] ?? 60000),
      maxRequetes: Number(process.env['RATE_LIMIT_MAX'] ?? 120),
    },
    identite: {
      cfTeamDomain: texteNonVide(process.env['CF_ACCESS_TEAM_DOMAIN']),
      cfAud: texteNonVide(process.env['CF_ACCESS_AUD']),
      devHeaderAutorise: process.env['NODE_ENV'] !== 'production',
    },
    adminEmails: parseAdminEmails(process.env['ADMIN_EMAILS']),
    foyerAuthzEnforce: process.env['FOYER_AUTHZ_ENFORCE'] === '1',
  };
}
