import { forwardRef } from 'react';
import type { ReactNode, Ref } from 'react';

/**
 * Mode de restitution du message aux technologies d'assistance.
 *
 * `alert` convient à une erreur produite par une SOUMISSION (l'annonce suit une
 * action délibérée). `aucun` est indispensable aux messages recalculés À CHAQUE
 * FRAPPE (validité d'une plage horaire, longueur d'un objet de mail) : leur
 * coller `role="alert"` provoquerait une annonce par caractère saisi.
 */
export type RestitutionErreur = 'alert' | 'polite' | 'aucun';

export interface ChampErreurProps {
  /** Message. `null`, `undefined` ou chaîne vide → rien n'est rendu. */
  children?: ReactNode;
  /** Id référencé par l'`aria-describedby` du contrôle décrit. */
  id?: string;
  /**
   * `span` : erreur LIÉE à un champ (frère direct du contrôle — un `<div>`
   * intercalé casserait `label { display: block }` et `.champs-duo > * { flex: 1 }`).
   * `p` : erreur GLOBALE de formulaire.
   */
  balise?: 'span' | 'p';
  restitution?: RestitutionErreur;
  /**
   * Rend le message focusable (`tabIndex={-1}`) pour un focus programmatique
   * après échec de soumission. À combiner avec une `ref`.
   */
  focalisable?: boolean;
}

/**
 * Message d'erreur de formulaire. Utilisable LIÉ à un champ (via `id`, référencé
 * par l'`aria-describedby` du contrôle) ou SEUL — erreur globale, erreur de
 * champ non rattachée, message de validation client.
 *
 * La couleur vient de la classe `.debit` (`var(--rouge)`), pas d'un style
 * inline : le contraste AA en dépend et le balayage `getComputedStyle` la mesure.
 */
export const ChampErreur = forwardRef<HTMLElement, ChampErreurProps>(
  function ChampErreur(
    {
      children,
      id,
      balise = 'span',
      restitution = 'alert',
      focalisable = false,
    },
    ref,
  ) {
    // `false` est traité comme « pas de message » : les appelants migrent des
    // rendus conditionnels `{erreur && <span…>}`, dont la valeur fausse est
    // souvent `false` et non `undefined`. Sans ce garde, on rendrait une région
    // `role="alert"` VIDE — annoncée comme une alerte sans contenu.
    if (
      children === null ||
      children === undefined ||
      children === false ||
      children === ''
    ) {
      return null;
    }
    const Balise = balise;
    return (
      <Balise
        // `ref` est typée HTMLElement : la balise varie (span | p).
        ref={ref as Ref<HTMLSpanElement & HTMLParagraphElement>}
        className="debit"
        {...(id === undefined ? {} : { id })}
        {...(restitution === 'alert' ? { role: 'alert' as const } : {})}
        {...(restitution === 'polite'
          ? { role: 'status' as const, 'aria-live': 'polite' as const }
          : {})}
        {...(focalisable ? { tabIndex: -1 } : {})}
      >
        {children}
      </Balise>
    );
  },
);
