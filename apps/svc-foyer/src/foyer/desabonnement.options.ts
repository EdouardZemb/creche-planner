export const OPTIONS_DESABONNEMENT = Symbol('OPTIONS_DESABONNEMENT');

/**
 * Points de variance du désabonnement one-click (RFC 8058), fournis depuis la
 * config du service. Le `secret` signe les jetons `desabonnement_token`,
 * `ttlJours` borne leur validité.
 */
export interface OptionsDesabonnement {
  readonly secret: string;
  readonly ttlJours: number;
}
