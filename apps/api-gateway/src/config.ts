/** Réglages du rate-limit (fenêtre glissante simple, en mémoire). */
export interface RateLimitConfig {
  /** Largeur de la fenêtre (ms). */
  readonly fenetreMs: number;
  /** Nombre maximal de requêtes autorisées par client sur la fenêtre. */
  readonly maxRequetes: number;
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
}

/** Découpe une liste d'environnement « a,b ,c » en tableau nettoyé. */
function parseListe(valeur: string | undefined): string[] {
  return (valeur ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

/**
 * Garde-fou de démarrage (AQ-01, doc 27) : en production, l'absence de
 * `GATEWAY_TOKEN` doit être un **choix explicite**, pas un oubli de config.
 *
 * Lève si `NODE_ENV === 'production'` sans jeton (absent ou vide) **et** sans
 * l'échappatoire `GATEWAY_AUTH_DISABLED=1`. La prod actuelle tourne
 * volontairement sans jeton (gateway non exposée : reverse-proxy + ports non
 * publiés + Cloudflare Access — décision doc 24) : c'est l'override
 * `docker-compose.server.yml` qui pose l'échappatoire, pas un défaut implicite.
 */
export function verifierConfigProduction(
  env: Record<string, string | undefined> = process.env,
): void {
  if (env['NODE_ENV'] !== 'production') {
    return;
  }
  const jeton = env['GATEWAY_TOKEN']?.trim();
  if (jeton !== undefined && jeton !== '') {
    return;
  }
  if (env['GATEWAY_AUTH_DISABLED'] === '1') {
    return;
  }
  throw new Error(
    "GATEWAY_TOKEN requis en production : sans lui l'authentification de la " +
      'gateway est désactivée. Pour la désactiver volontairement (gateway non ' +
      'exposée, cf. doc 24), poser GATEWAY_AUTH_DISABLED=1.',
  );
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
  };
}
