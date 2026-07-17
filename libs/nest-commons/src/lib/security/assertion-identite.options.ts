/**
 * Config d'assertion inter-services lue par le guard aval : le **secret** partagé
 * (`ASSERTION_IDENTITE_SECRET`) et le flag d'**enforce** (`INTERSERVICE_AUTHZ_ENFORCE`).
 * Chaque service la matérialise dans son `config.ts` (pattern `loadConfig()`) — la
 * même valeur sert à la fois le guard (vérification) et les clients service→service
 * (signature machine).
 */
export interface ConfigAssertion {
  /** Secret HMAC partagé gateway + services. **Absent ⇒ mode legacy** (passe). */
  readonly secret: string | undefined;
  /** `INTERSERVICE_AUTHZ_ENFORCE=1` ⇒ refus réel (401). Sinon observe-only. */
  readonly enforce: boolean;
}

/**
 * Lit la config d'assertion depuis l'environnement (défauts partagés par les 5
 * services). Un secret absent, vide ou blanc ⇒ `undefined` (mode legacy) ;
 * l'enforce n'est actif que sur la valeur exacte `'1'`. Centralisé ici pour que
 * chaque `config.ts` de service se limite à `assertion: lireConfigAssertion()`.
 */
export function lireConfigAssertion(
  env: NodeJS.ProcessEnv = process.env,
): ConfigAssertion {
  const brut = env['ASSERTION_IDENTITE_SECRET']?.trim();
  return {
    secret: brut !== undefined && brut !== '' ? brut : undefined,
    enforce: env['INTERSERVICE_AUTHZ_ENFORCE'] === '1',
  };
}

/** Jeton d'injection des options du guard d'assertion. */
export const OPTIONS_ASSERTION_IDENTITE = Symbol('OPTIONS_ASSERTION_IDENTITE');

/**
 * Points de variance du guard, fournis par chaque service. `chargerConfig` est
 * **relu à chaque requête** (typiquement le `loadConfig()` du service) : la
 * bascule enforce prend effet sans redémarrage de la classe guard.
 */
export interface OptionsAssertionIdentite {
  readonly chargerConfig: () => { readonly assertion: ConfigAssertion };
}
