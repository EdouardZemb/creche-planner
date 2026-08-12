import type { ErreurChamp } from './erreurs';

/**
 * Corps d'erreur **tel que la passerelle l'émet** (`application/problem+json`,
 * RFC 9457), pour les tests de composants.
 *
 * Ce fichier existe à cause d'`AN-27` : six tests d'écrans fabriquaient chacun
 * leur corps d'erreur, tous sur la même forme supposée — un tableau nu
 * `[{ champ, message }]` — que la passerelle n'a jamais émise. Les six passaient,
 * et pas un parent n'a jamais vu une erreur par champ. Un constructeur unique ne
 * garantit pas la vérité à lui seul, mais il fait qu'une divergence se corrige à
 * **un** endroit au lieu de six, et qu'elle se voit.
 */
export function problemeValidation(
  erreurs: readonly ErreurChamp[],
  status = 400,
): Record<string, unknown> {
  return {
    type: 'about:blank',
    title: 'Requête invalide',
    status,
    detail: 'données invalides',
    erreurs: [...erreurs],
  };
}

/** Problème portant un **code métier** (409 discriminés par les écrans). */
export function problemeCode(
  code: string,
  status = 409,
): Record<string, unknown> {
  return {
    type: `urn:probleme:creche-planner:${code.toLowerCase().replaceAll('_', '-')}`,
    title: code,
    status,
    code,
  };
}
