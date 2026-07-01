import { createHmac, timingSafeEqual } from 'node:crypto';

/**
 * Jeton de **désabonnement one-click** (RFC 8058, PR5). Le modèle retenu (§9.5) est
 * un jeton **en table** (`desabonnement_token`, auditable, one-shot) : le jeton
 * transporté ne porte donc que le strict nécessaire — l'identifiant `jti` et
 * l'expiration `exp` — signés en HMAC-SHA256 pour rejeter d'emblée toute valeur
 * forgée sans coûteux accès base. Le `jti` (UUID v4) est déjà non-devinable ; la
 * signature ajoute une défense et évite l'énumération. Les métadonnées
 * `(parent, type, canal)` restent **la ligne en base**, seule source de vérité.
 *
 * Format compact `<payloadB64url>.<signatureB64url>` (mini-JWS maison, sans
 * dépendance) : ni JWT ni claims sensibles, aucune PII dans le jeton.
 */

/** Charge utile signée : identifiant du jeton + expiration (epoch secondes). */
export interface ChargeJeton {
  readonly jti: string;
  readonly exp: number;
}

function base64url(buf: Buffer): string {
  return buf.toString('base64url');
}

function signature(payloadB64: string, secret: string): Buffer {
  return createHmac('sha256', secret).update(payloadB64).digest();
}

/** Signe une charge utile en `<payload>.<signature>` (base64url). */
export function signerJeton(charge: ChargeJeton, secret: string): string {
  const payloadB64 = base64url(Buffer.from(JSON.stringify(charge), 'utf8'));
  return `${payloadB64}.${base64url(signature(payloadB64, secret))}`;
}

/**
 * Vérifie la signature et décode la charge. Renvoie `null` pour **tout** jeton
 * malformé, mal signé ou expiré — l'appelant retourne alors une erreur générique
 * (pas de fuite : on ne distingue pas « inexistant » de « invalide »). La
 * comparaison de signature est à temps constant (`timingSafeEqual`).
 */
export function verifierJeton(
  jeton: string,
  secret: string,
  maintenant: Date,
): ChargeJeton | null {
  const parties = jeton.split('.');
  if (parties.length !== 2) {
    return null;
  }
  const [payloadB64, signatureB64] = parties;
  if (!payloadB64 || !signatureB64) {
    return null;
  }
  const attendue = signature(payloadB64, secret);
  let fournie: Buffer;
  try {
    fournie = Buffer.from(signatureB64, 'base64url');
  } catch {
    return null;
  }
  if (
    fournie.length !== attendue.length ||
    !timingSafeEqual(fournie, attendue)
  ) {
    return null;
  }
  let charge: unknown;
  try {
    charge = JSON.parse(Buffer.from(payloadB64, 'base64url').toString('utf8'));
  } catch {
    return null;
  }
  if (
    typeof charge !== 'object' ||
    charge === null ||
    typeof (charge as { jti?: unknown }).jti !== 'string' ||
    typeof (charge as { exp?: unknown }).exp !== 'number'
  ) {
    return null;
  }
  const { jti, exp } = charge as ChargeJeton;
  if (exp * 1000 <= maintenant.getTime()) {
    return null;
  }
  return { jti, exp };
}
