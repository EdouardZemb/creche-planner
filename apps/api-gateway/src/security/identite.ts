import { createRemoteJWKSet, jwtVerify, type JWTVerifyGetKey } from 'jose';

/** Identité d'un parent dérivée d'un e-mail vérifié (Cloudflare Access ou dev). */
export interface Identite {
  /** E-mail **vérifié** (jamais un en-tête brut en prod). */
  readonly email: string;
}

/** Requête HTTP enrichie par le guard d'identité, lue par le guard d'appartenance. */
export interface RequeteIdentifiable {
  readonly headers: Record<string, string | string[] | undefined>;
  readonly params?: Record<string, string | undefined>;
  readonly query?: Record<string, unknown>;
  /** Corps déjà parsé (body-parser tourne avant les guards). Source `body:…`. */
  readonly body?: Record<string, unknown>;
  readonly url?: string;
  /** Posée par `IdentiteGuard` quand une identité a pu être établie. */
  identite?: Identite;
}

/** Paramètres de vérification d'un JWT Cloudflare Access. */
export interface OptionsJwtCf {
  /** Issuer attendu = team domain CF (ex. `https://x.cloudflareaccess.com`). */
  readonly issuer: string;
  /** Audience attendue = tag `aud` de l'application CF Access. */
  readonly audience: string;
}

/**
 * Valide un JWT Cloudflare Access et en extrait l'e-mail vérifié.
 *
 * La signature est vérifiée via `cles` (le JWKS), l'`issuer` et l'`audience`
 * sont contrôlés par `jose`. Lève si la signature, l'issuer, l'audience ou
 * l'expiration sont invalides, ou si le claim `email` est absent. Le resolver de
 * clés est **injecté** pour rester testable (JWKS local en test, distant en
 * prod via {@link jwksCloudflare}).
 */
export async function emailDepuisJwtCf(
  jwt: string,
  options: OptionsJwtCf,
  cles: JWTVerifyGetKey,
): Promise<string> {
  const { payload } = await jwtVerify(jwt, cles, {
    issuer: options.issuer,
    audience: options.audience,
  });
  const email = payload['email'];
  if (typeof email !== 'string' || email.trim() === '') {
    throw new Error(
      'claim « email » absent ou vide dans le JWT Cloudflare Access',
    );
  }
  return email;
}

/**
 * JWKS distant Cloudflare Access, **mémoïsé par team domain** : `jose` met en
 * cache les clés et ne re-télécharge que sur rotation. L'URL des certificats est
 * `<teamDomain>/cdn-cgi/access/certs`.
 */
const jwksParDomaine = new Map<string, JWTVerifyGetKey>();
export function jwksCloudflare(teamDomain: string): JWTVerifyGetKey {
  let jwks = jwksParDomaine.get(teamDomain);
  if (jwks === undefined) {
    jwks = createRemoteJWKSet(new URL(`${teamDomain}/cdn-cgi/access/certs`));
    jwksParDomaine.set(teamDomain, jwks);
  }
  return jwks;
}

/** En-tête CF Access portant le JWT signé (injecté au bord en prod). */
export const ENTETE_JWT_CF = 'cf-access-jwt-assertion';
/** En-tête de dev injectant une identité sans Cloudflare (verrouillé hors prod). */
export const ENTETE_DEV_EMAIL = 'x-dev-user-email';

/** Première valeur d'un en-tête HTTP (Express peut renvoyer un tableau). */
export function entete(
  headers: Record<string, string | string[] | undefined>,
  nom: string,
): string | undefined {
  const brut = headers[nom];
  return Array.isArray(brut) ? brut[0] : brut;
}
