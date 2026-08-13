import { champEnv, type ValeursEnv } from '../config/env.js';

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
 * Les deux variables d'environnement de l'assertion, **déclarées une fois** pour
 * les cinq services : `secret` absent, vide ou blanc ⇒ mode legacy ; l'enforce
 * n'est actif que sur la valeur exacte `'1'` (`AM-30` : la bascule reste
 * ouverte, mais elle est désormais visible dans chaque schéma).
 *
 * À reprendre dans le `champs` de `lireEnv` par un simple `...CHAMPS_ASSERTION`,
 * puis à matérialiser par `configAssertion(valeurs)`. La lecture directe de
 * `process.env` qui vivait ici (`lireConfigAssertion`) a disparu au lot 5 : deux
 * lectures d'une même variable — l'une validée, l'autre non — est précisément la
 * forme d'`AN-20`.
 */
export const CHAMPS_ASSERTION = {
  ASSERTION_IDENTITE_SECRET: champEnv.secret(),
  INTERSERVICE_AUTHZ_ENFORCE: champEnv.bascule(),
} as const;

/** Matérialise la config d'assertion depuis les valeurs déjà validées. */
export function configAssertion(
  valeurs: ValeursEnv<typeof CHAMPS_ASSERTION>,
): ConfigAssertion {
  return {
    secret: valeurs.ASSERTION_IDENTITE_SECRET,
    enforce: valeurs.INTERSERVICE_AUTHZ_ENFORCE,
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
