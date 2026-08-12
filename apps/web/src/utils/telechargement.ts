/**
 * Téléchargement d'un fichier produit côté navigateur.
 *
 * Cette primitive vivait dans `couts/export.ts`, seul endroit du dépôt qui
 * téléchargeait quoi que ce soit. L'export de portabilité (lot 3) en est le
 * second : la danse `Blob` → `createObjectURL` → ancre → `revokeObjectURL` est
 * remontée ici plutôt que recopiée, et `telechargerCsv` s'appuie désormais
 * dessus (CONVENTIONS.md — dérivation plutôt que miroir).
 */

/**
 * Déclenche le téléchargement de `parties` sous le nom `nomFichier`. Sans effet
 * si l'environnement n'a pas de DOM (no-op défensif, ex. SSR ou test sans jsdom).
 *
 * L'URL d'objet est révoquée dans un `finally` : un `click()` qui lève laisserait
 * sinon le blob en mémoire pour la durée de vie de l'onglet.
 */
export function telechargerFichier(
  nomFichier: string,
  parties: readonly BlobPart[],
  type: string,
): void {
  if (
    typeof document === 'undefined' ||
    typeof URL.createObjectURL !== 'function'
  ) {
    return;
  }
  const url = URL.createObjectURL(new Blob([...parties], { type }));
  try {
    const a = document.createElement('a');
    a.href = url;
    a.download = nomFichier;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
  } finally {
    URL.revokeObjectURL(url);
  }
}

/**
 * Téléchargement d'un document JSON, indenté pour rester lisible à l'œil : un
 * export de portabilité est d'abord lu par la personne qui l'a demandé, avant
 * d'être éventuellement rechargé par un outil.
 */
export function telechargerJson(nomFichier: string, valeur: unknown): void {
  telechargerFichier(
    nomFichier,
    [JSON.stringify(valeur, null, 2)],
    'application/json;charset=utf-8;',
  );
}
