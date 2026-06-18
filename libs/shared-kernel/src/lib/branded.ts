/**
 * Types « brandés » (nominal typing) — doc 03 §3.
 *
 * TypeScript est structurellement typé : deux `string` sont interchangeables,
 * même si l'une est un `FoyerId` et l'autre un `EnfantId`. Un type brandé attache
 * une étiquette fantôme (effacée à la compilation, **zéro coût runtime**) qui rend
 * deux primitifs de même forme incompatibles, sauf passage explicite par le
 * constructeur dédié. On rend ainsi *irreprésentables* les confusions d'identité.
 *
 * @example
 * type FoyerId = Brand<string, 'FoyerId'>;
 * const asFoyerId = brander<string, 'FoyerId'>();
 * const id = asFoyerId(uuid);     // FoyerId
 * const x: string = id;           // OK : un FoyerId reste un string
 * const y: FoyerId = uuid;        // ✗ erreur : un string brut n'est pas un FoyerId
 */
declare const symboleBrand: unique symbol;

export type Brand<T, B extends string> = T & {
  readonly [symboleBrand]: B;
};

/**
 * Fabrique un convertisseur vers un type brandé. À n'utiliser qu'à la frontière
 * (après validation/parsing), là où l'on *sait* que la valeur respecte l'invariant
 * de l'identité — typiquement la sortie d'un schéma Zod ou d'une lecture DB.
 */
export function brander<T, B extends string>(): (valeur: T) => Brand<T, B> {
  return (valeur) => valeur as Brand<T, B>;
}
