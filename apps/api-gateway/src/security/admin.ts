/**
 * Rôle **administrateur** (option b-ii, provisioning admin) — helpers purs et
 * testables. L'admin est identifié par son **e-mail vérifié** (Cloudflare Access
 * B1) présent dans l'allowlist `ADMIN_EMAILS` (`config.adminEmails`).
 *
 * **Opt-in** : allowlist vide ⇒ gating **désactivé** (toutes les requêtes
 * passent). Voir {@link estGatingAdminActif}. La prod actuelle, sans
 * `ADMIN_EMAILS`, n'est donc pas impactée.
 */

/** Normalise un e-mail pour comparaison d'allowlist (trim + minuscule). */
export function normaliserEmail(email: string): string {
  return email.trim().toLowerCase();
}

/**
 * Le gating admin est-il actif ? Vrai dès que l'allowlist est **non vide**
 * (opt-in). Vide ⇒ inactif (idiome du repo, cf. `GATEWAY_TOKEN` absent).
 */
export function estGatingAdminActif(adminEmails: readonly string[]): boolean {
  return adminEmails.length > 0;
}

/**
 * L'e-mail appartient-il à l'allowlist admin (comparaison insensible à la
 * casse) ? `undefined`/vide ⇒ `false`. L'allowlist est supposée déjà normalisée
 * en minuscules (cf. `parseAdminEmails` dans `config.ts`).
 */
export function estAdmin(
  email: string | undefined,
  adminEmails: readonly string[],
): boolean {
  if (email === undefined) {
    return false;
  }
  const cible = normaliserEmail(email);
  return cible !== '' && adminEmails.includes(cible);
}
