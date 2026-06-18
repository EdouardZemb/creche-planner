import { libelleSigle } from '../utils/glossaire';

export interface AbbrProps {
  /** Sigle à afficher (ex. « RFR »). Sert aussi de clé du glossaire. */
  sigle: string;
  /**
   * Libellé long. Si absent, résolu depuis `glossaire.ts`. Si le sigle est
   * inconnu du glossaire, on retombe sur le sigle lui-même (jamais de `title` vide).
   */
  title?: string;
}

/**
 * Abréviation accessible (UT-08). Rend un `<abbr title>` dont le titre est
 * exposé aux lecteurs d'écran ET atteignable au clavier : `tabIndex={0}` rend
 * l'élément focusable, condition pour que le tooltip natif du `title` soit
 * déclenchable sans souris. Le `title` fournit le nom accessible de l'élément.
 */
export function Abbr({ sigle, title }: AbbrProps) {
  const libelle = title ?? libelleSigle(sigle) ?? sigle;
  return (
    // tabIndex délibéré (UT-08) : rend l'<abbr> focusable au clavier pour
    // déclencher le tooltip natif du `title` sans souris (cf. JSDoc).
    // eslint-disable-next-line jsx-a11y/no-noninteractive-tabindex
    <abbr title={libelle} tabIndex={0}>
      {sigle}
    </abbr>
  );
}
