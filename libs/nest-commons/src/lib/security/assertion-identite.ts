import { createHmac, timingSafeEqual } from 'node:crypto';

/**
 * **Assertion d'identité inter-services** (chantier « fondations backend », lot 3).
 *
 * Chaque requête entrant dans un `svc-*` porte la **preuve signée HMAC-SHA256**
 * qu'elle vient de la gateway (assertion « parent », portant l'e-mail vérifié et
 * les foyers autorisés) ou d'un service interne identifié (assertion « machine »).
 * Le format est un **mini-JWS maison** — `base64url(payload JSON)` + `.` +
 * `base64url(signature)` — copié du modèle éprouvé du désabonnement one-click
 * (`apps/svc-foyer/src/foyer/desabonnement.jeton.ts`) : aucune dépendance nouvelle
 * (`node:crypto`), pas de `jose` côté services.
 *
 * Ce lot installe la tuyauterie en **mode observe** (le guard journalise mais ne
 * refuse rien) ; le lot 4 ajoute le scoping par ressource et la bascule enforce.
 */

/** En-tête HTTP transportant l'assertion signée. */
export const ENTETE_ASSERTION = 'x-assertion-identite';

/** Version courante du format de charge utile (permet une évolution future). */
export const VERSION_ASSERTION = 1 as const;

/** Durée de vie d'une assertion (secondes) : `exp = iat + DUREE_VIE_S` (H4). */
export const DUREE_VIE_ASSERTION_S = 60;

/**
 * Tolérance de dérive d'horloge à la vérification (secondes). Mono-machine, ±30 s
 * est très largement suffisant (H4) : une assertion est acceptée si l'instant de
 * vérification tombe dans `[iat - 30 s, exp + 30 s]`.
 */
export const TOLERANCE_DERIVE_S = 30;

/**
 * Charge utile signée. **Exactement un** de `email` (assertion parent) ou `machine`
 * (assertion service→service) est présent ; un payload mixte ou vide est rejeté à
 * la vérification. `foyers`/`admin` n'accompagnent qu'une assertion parent.
 */
export interface ChargeAssertion {
  readonly v: typeof VERSION_ASSERTION;
  /** E-mail vérifié du parent (assertion parent). Exclusif de `machine`. */
  readonly email?: string;
  /** Foyers dont l'e-mail est parent actif (résolus par la gateway). */
  readonly foyers?: readonly string[];
  /** L'e-mail est administrateur (bypass, aligné sur la gateway). */
  readonly admin?: boolean;
  /** Nom du service émetteur (assertion machine). Exclusif de `email`. */
  readonly machine?: string;
  /** Émission (epoch secondes). */
  readonly iat: number;
  /** Expiration (epoch secondes). */
  readonly exp: number;
}

/** Entrée de signature d'une **assertion parent** (identité vérifiée). */
export interface EntreeAssertionParent {
  readonly email: string;
  readonly foyers?: readonly string[] | undefined;
  readonly admin?: boolean | undefined;
}

/** Entrée de signature d'une **assertion machine** (service émetteur). */
export interface EntreeAssertionMachine {
  readonly machine: string;
}

/** Entrée de signature : parent (avec e-mail) **ou** machine (avec service). */
export type EntreeAssertion = EntreeAssertionParent | EntreeAssertionMachine;

function base64url(buf: Buffer): string {
  return buf.toString('base64url');
}

function signature(payloadB64: string, secret: string): Buffer {
  return createHmac('sha256', secret).update(payloadB64).digest();
}

/** Vrai si l'entrée est une assertion machine (présence de `machine`). */
function estMachine(entree: EntreeAssertion): entree is EntreeAssertionMachine {
  return 'machine' in entree && typeof entree.machine === 'string';
}

/**
 * Signe une entrée en assertion compacte `<payload>.<signature>` (base64url).
 * `maintenant` est injectable pour les tests ; par défaut l'horloge courante.
 * Les champs `undefined` sont omis du JSON (donc de la charge signée).
 */
export function signerAssertion(
  entree: EntreeAssertion,
  secret: string,
  maintenant: Date = new Date(),
): string {
  const iat = Math.floor(maintenant.getTime() / 1000);
  const base = {
    v: VERSION_ASSERTION,
    iat,
    exp: iat + DUREE_VIE_ASSERTION_S,
  };
  const charge: ChargeAssertion = estMachine(entree)
    ? { ...base, machine: entree.machine }
    : {
        ...base,
        email: entree.email,
        ...(entree.foyers !== undefined ? { foyers: entree.foyers } : {}),
        ...(entree.admin !== undefined ? { admin: entree.admin } : {}),
      };
  const payloadB64 = base64url(Buffer.from(JSON.stringify(charge), 'utf8'));
  return `${payloadB64}.${base64url(signature(payloadB64, secret))}`;
}

/** Un tableau homogène de chaînes (foyers), ou `undefined`. */
function estTableauDeChaines(v: unknown): v is readonly string[] {
  return Array.isArray(v) && v.every((e) => typeof e === 'string');
}

/**
 * Décode et **valide** une assertion : signature (temps constant), forme du
 * payload, invariant « exactement un de email|machine », et fenêtre de validité
 * avec tolérance de dérive (±{@link TOLERANCE_DERIVE_S} s). Renvoie `null` pour
 * **toute** assertion malformée, mal signée, mixte, expirée ou non encore valide
 * — comme le jeton de désabonnement, on ne distingue pas les motifs (pas de fuite).
 */
export function verifierAssertion(
  jeton: string,
  secret: string,
  maintenant: Date,
): ChargeAssertion | null {
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
  let brut: unknown;
  try {
    brut = JSON.parse(Buffer.from(payloadB64, 'base64url').toString('utf8'));
  } catch {
    return null;
  }
  return valider(brut, maintenant);
}

/** Valide la forme, l'invariant email/machine et la fenêtre temporelle. */
function valider(brut: unknown, maintenant: Date): ChargeAssertion | null {
  if (typeof brut !== 'object' || brut === null) {
    return null;
  }
  const o = brut as Record<string, unknown>;
  if (o['v'] !== VERSION_ASSERTION) {
    return null;
  }
  if (typeof o['iat'] !== 'number' || typeof o['exp'] !== 'number') {
    return null;
  }
  const aEmail = typeof o['email'] === 'string';
  const aMachine = typeof o['machine'] === 'string';
  // Exactement un des deux : ni les deux (payload mixte forgé), ni aucun.
  if (aEmail === aMachine) {
    return null;
  }
  if (o['foyers'] !== undefined && !estTableauDeChaines(o['foyers'])) {
    return null;
  }
  if (o['admin'] !== undefined && typeof o['admin'] !== 'boolean') {
    return null;
  }
  const iat = o['iat'];
  const exp = o['exp'];
  const now = maintenant.getTime();
  // Non encore valide (horloge émetteur en avance au-delà de la tolérance).
  if (now < (iat - TOLERANCE_DERIVE_S) * 1000) {
    return null;
  }
  // Expirée au-delà de la tolérance.
  if (now > (exp + TOLERANCE_DERIVE_S) * 1000) {
    return null;
  }
  return construire(o, aEmail);
}

/** Reconstruit la charge typée à partir d'un payload déjà validé. */
function construire(
  o: Record<string, unknown>,
  aEmail: boolean,
): ChargeAssertion {
  const base = {
    v: VERSION_ASSERTION,
    iat: o['iat'] as number,
    exp: o['exp'] as number,
  } as const;
  if (aEmail) {
    return {
      ...base,
      email: o['email'] as string,
      ...(o['foyers'] !== undefined
        ? { foyers: o['foyers'] as readonly string[] }
        : {}),
      ...(o['admin'] !== undefined ? { admin: o['admin'] as boolean } : {}),
    };
  }
  return { ...base, machine: o['machine'] as string };
}

/**
 * En-têtes d'assertion **machine** pour un appel service→service (repli/relecture).
 * Signe `{ machine }` avec `secret` et renvoie `{ [ENTETE_ASSERTION]: jeton }`.
 * Si le secret est absent (environnement non migré, mode legacy), renvoie `{}` :
 * l'appel part sans en-tête, le guard aval le laisse passer (legacy/observe).
 */
export function entetesAssertionMachine(
  machine: string,
  secret: string | undefined,
  maintenant: Date = new Date(),
): Record<string, string> {
  if (secret === undefined) {
    return {};
  }
  return {
    [ENTETE_ASSERTION]: signerAssertion({ machine }, secret, maintenant),
  };
}
