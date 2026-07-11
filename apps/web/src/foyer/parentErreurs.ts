import { ApiError } from '../api/client';
import { messageErreur } from '../utils/erreurs';
import type { ErreurChamp } from '../utils/erreurs';

/** Lit le `code` machine d'un corps d'erreur amont (`{ code, ... }`), si présent. */
function codeErreur(err: unknown): string | undefined {
  if (
    err instanceof ApiError &&
    typeof err.corps === 'object' &&
    err.corps !== null
  ) {
    const code = (err.corps as Record<string, unknown>)['code'];
    if (typeof code === 'string') {
      return code;
    }
  }
  return undefined;
}

/**
 * Message d'erreur d'une écriture parent, **précis par code** amont. `svc-foyer`
 * porte des 409 structurés (`code`) que le BFF relaie tel quel (cf. `relayer` +
 * `ErreurAmont`) ; on les traduit ici en langage parent. Un 409 **sans** code
 * (repli, ancien BFF) retombe sur le message fusionné historique ; les autres
 * statuts passent par le message standard.
 *
 * Extrait de `ParentsSection` pour être testable isolément.
 */
export function messageErreurParent(err: unknown): string {
  switch (codeErreur(err)) {
    case 'EMAIL_DEJA_UTILISE':
      return 'Cette adresse e-mail est déjà utilisée par un autre parent.';
    case 'PARENT_PRINCIPAL_EXISTANT':
      return 'Un contact principal existe déjà. Décochez-le d’abord sur l’autre parent.';
    case 'DERNIER_PARENT_ACTIF':
      return 'Impossible de retirer le dernier parent : la famille doit garder au moins un parent pour y accéder.';
  }
  if (err instanceof ApiError && err.status === 409) {
    // 409 sans code (repli) : on rend les deux causes historiques plutôt qu'un
    // « Conflit » abstrait.
    return 'Adresse e-mail déjà utilisée, ou un parent principal existe déjà pour ce foyer.';
  }
  return messageErreur(err);
}

/**
 * Le BFF valide un tableau `parents` envoyé en bloc (création de foyer) et renvoie
 * ses erreurs indexées par position (`parents.<i>.<champ>`, cf. `path.join('.')`).
 * Comme on ne transmet pas les lignes vides, cet index ne correspond pas à la
 * position dans l'état du formulaire : on le retraduit vers l'id stable de la
 * ligne (`parent.<id>.<champ>`) pour relier le message au bon champ via
 * `aria-describedby`. Les autres erreurs (champs scalaires du foyer, ou erreurs
 * non indexées des écritures parent unitaires de l'écran d'édition) passent
 * inchangées.
 *
 * Partagé entre la création (`FoyerFormPage`, tableau de parents) et l'édition
 * (`ParentsSection`, écritures unitaires) pour ne pas dupliquer la convention.
 */
export function retraduireErreurParent(
  erreur: ErreurChamp,
  idsEnvoyes: readonly string[],
): ErreurChamp {
  const correspondance = /^parents\.(\d+)\.(.+)$/.exec(erreur.champ);
  if (correspondance) {
    const index = Number(correspondance[1]);
    const id = idsEnvoyes[index];
    if (id !== undefined) {
      return {
        champ: `parent.${id}.${correspondance[2]}`,
        message: erreur.message,
      };
    }
  }
  return erreur;
}
