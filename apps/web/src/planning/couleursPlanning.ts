// Couleurs des états d'un jour de planning, lues depuis les tokens CSS (:root)
// avec repli (jsdom en test ne calcule pas les variables CSS). « Ajouté » et
// « retiré » ne sont pas des modes : on lit donc les tokens de la palette
// directement (vert / rouge), distincts de la couleur du mode (jour gardé).

/** Lit un token CSS `:root` avec une valeur de repli. */
export function couleurToken(token: string, repli: string): string {
  const valeur =
    typeof window !== 'undefined' && typeof getComputedStyle === 'function'
      ? getComputedStyle(document.documentElement)
          .getPropertyValue(token)
          .trim()
      : '';
  return valeur || repli;
}

/** Jour ajouté ponctuellement (hors contrat) → vert. */
export function couleurAjoute(): string {
  return couleurToken('--vert', '#15803d');
}

/** Jour retiré / absent → rouge. */
export function couleurRetire(): string {
  return couleurToken('--rouge', '#b91c1c');
}

/** Jour gardé avec ajustement partiel (présence réduite) → ambre. */
export function couleurAjuste(): string {
  return couleurToken('--ambre', '#b45309');
}
