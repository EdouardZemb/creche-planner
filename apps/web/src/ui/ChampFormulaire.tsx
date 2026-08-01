import type { ReactNode } from 'react';
import { ChampErreur } from './ChampErreur';

/**
 * Attributs à ÉTALER sur le contrôle (`input`, `select`, `textarea`). Le contrôle
 * reste écrit par l'appelant : une union fermée de `type` exclurait `select` et
 * `textarea`, et chaque champ a ses propres `value`/`onChange`/`min`/`step`.
 */
export interface ProprietesControle {
  id: string;
  'aria-required'?: true;
  'aria-invalid'?: true;
  'aria-describedby'?: string;
}

export interface ChampFormulaireProps {
  /**
   * Id du CONTRÔLE. Toujours fourni par l'appelant, jamais dérivé en interne :
   * des ids littéraux sont référencés par les tests (`contrat-valideDu`, `rfr`,
   * `nbParts`…) et d'autres dérivent d'un `useId()` ou d'une clé de liste.
   */
  id: string;
  /**
   * Libellé. `ReactNode` et non `string` : il porte le marqueur d'obligation
   * `<span aria-hidden="true">*</span>` (hors nom accessible), la mention
   * `(facultatif)` (dans le nom accessible) ou un `<Abbr>` focusable.
   */
  libelle: ReactNode;
  /**
   * Message d'erreur courant. `null`/`undefined` → champ valide.
   *
   * Le `| undefined` est EXPLICITE (et non un simple `?`) : sous
   * `exactOptionalPropertyTypes`, une prop optionnelle refuse qu'on lui passe
   * `undefined` en toutes lettres — or c'est précisément ce que rendent les
   * `erreurPour(champ)` des formulaires, qui cherchent dans une liste d'erreurs.
   */
  erreur?: string | null | undefined;
  /**
   * Id du message d'erreur. DÉCOUPLÉ de `id` : la clé d'erreur est le nom de
   * champ SERVEUR, pas le nom DOM (contrôle `…-naissance` ↔ erreur
   * `…-dateNaissance-err`). Obligatoire dès qu'`erreur` peut être renseignée.
   */
  idErreur?: string;
  /**
   * Aide PERMANENTE, liée au contrôle en plus de l'erreur (aide en premier dans
   * la chaîne `aria-describedby`, comme dans le DOM). **Opt-in délibéré** : sept
   * tests lisent `aria-describedby` et passent son unique valeur à
   * `getElementById` — une aide ajoutée d'office les casserait tous.
   */
  aide?: ReactNode;
  /** Id de l'aide. Requis dès qu'`aide` est fournie. */
  idAide?: string;
  /**
   * Classes du nœud d'aide. Défaut `muted`. Certaines aides portent en plus une
   * classe de mise en forme load-bearing (`etab-aide` : `display: block`, taille
   * et marge) : sans ce point d'entrée, elles ne peuvent pas migrer.
   */
  classeAide?: string;
  /** Pose `aria-required="true"`. Indépendant du `required` HTML du contrôle. */
  requis?: boolean;
  children: (controle: ProprietesControle) => ReactNode;
}

/**
 * Champ de formulaire lié : `<label htmlFor>` + contrôle + aide optionnelle +
 * message d'erreur, avec le câblage ARIA (`aria-required`, `aria-invalid`,
 * `aria-describedby`) posé une seule fois.
 *
 * Rendu en **Fragment**, sans conteneur : dans les formulaires existants, le
 * label, le contrôle et le message sont des FRÈRES DIRECTS du `<form>` ou du
 * `<fieldset>`. Un `<div>` intercalé casserait `label { display: block }`,
 * `.champs-duo > * { flex: 1 }` et la cible tactile de `.case-cochable`.
 *
 * Couvre le patron « label lié » uniquement. Les cases à cocher et les boutons
 * radio du repo utilisent un `<label>` ENGLOBANT sans id : les faire entrer ici
 * produirait une prop `variante` qui ne simplifierait rien.
 */
export function ChampFormulaire({
  id,
  libelle,
  erreur,
  idErreur,
  aide,
  idAide,
  classeAide = 'muted',
  requis = false,
  children,
}: ChampFormulaireProps) {
  const enErreur = erreur !== null && erreur !== undefined && erreur !== '';
  const decrits = [
    ...(aide !== undefined && idAide !== undefined ? [idAide] : []),
    ...(enErreur && idErreur !== undefined ? [idErreur] : []),
  ];
  const controle: ProprietesControle = {
    id,
    // `aria-invalid` vaut `true` ou est ABSENT — jamais la chaîne "false", que
    // les lecteurs d'écran annonceraient comme un état.
    ...(requis ? { 'aria-required': true as const } : {}),
    ...(enErreur ? { 'aria-invalid': true as const } : {}),
    ...(decrits.length > 0 ? { 'aria-describedby': decrits.join(' ') } : {}),
  };
  return (
    <>
      <label htmlFor={id}>{libelle}</label>
      {children(controle)}
      {aide !== undefined && (
        <span
          className={classeAide}
          {...(idAide === undefined ? {} : { id: idAide })}
        >
          {aide}
        </span>
      )}
      <ChampErreur {...(idErreur === undefined ? {} : { id: idErreur })}>
        {erreur}
      </ChampErreur>
    </>
  );
}
