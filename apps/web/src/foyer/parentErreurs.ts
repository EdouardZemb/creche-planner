import type { ErreurChamp } from '../utils/erreurs';

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
