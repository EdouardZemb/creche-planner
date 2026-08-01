import { createRef } from 'react';
import { render, screen } from '@testing-library/react';
import { describe, it, expect } from 'vitest';
import { ChampErreur } from './ChampErreur';

describe('ChampErreur', () => {
  it('ne rend rien sans message', () => {
    const { container } = render(<ChampErreur>{null}</ChampErreur>);
    expect(container).toBeEmptyDOMElement();
  });

  it('ne rend rien pour un message vide (une chaîne vide n’est pas une erreur)', () => {
    const { container } = render(<ChampErreur>{''}</ChampErreur>);
    expect(container).toBeEmptyDOMElement();
  });

  it('ne rend rien pour `false` (valeur fausse d’un rendu conditionnel migré)', () => {
    // `{erreur && msg}` produit `false`, pas `undefined` : sans garde, on
    // rendrait une région role="alert" vide.
    const erreur: string | null = null;
    const { container } = render(
      <ChampErreur>{erreur !== null && erreur}</ChampErreur>,
    );
    expect(container).toBeEmptyDOMElement();
  });

  it('rend un <span role="alert"> porteur de l’id référencé par aria-describedby', () => {
    render(<ChampErreur id="foyer-rfr-err">Montant invalide</ChampErreur>);
    const el = screen.getByRole('alert');
    expect(el.tagName).toBe('SPAN');
    expect(el).toHaveAttribute('id', 'foyer-rfr-err');
    // La couleur vient de `.debit` (var(--rouge)) : le contraste AA en dépend.
    expect(el).toHaveClass('debit');
    expect(el).toHaveTextContent('Montant invalide');
  });

  it('rend un <p> pour une erreur globale de formulaire', () => {
    render(<ChampErreur balise="p">Formulaire incomplet</ChampErreur>);
    expect(screen.getByRole('alert').tagName).toBe('P');
  });

  it('n’annonce rien en restitution « aucun » (message recalculé à chaque frappe)', () => {
    // Un role="alert" ici provoquerait une annonce par caractère saisi.
    render(
      <ChampErreur restitution="aucun">Plage horaire invalide</ChampErreur>,
    );
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(screen.getByText('Plage horaire invalide')).toHaveClass('debit');
  });

  it('annonce poliment en restitution « polite »', () => {
    render(<ChampErreur restitution="polite">Bientôt trop long</ChampErreur>);
    const el = screen.getByRole('status');
    expect(el).toHaveAttribute('aria-live', 'polite');
  });

  it('devient focalisable et acceptable en cible de focus programmatique', () => {
    const ref = createRef<HTMLElement>();
    render(
      <ChampErreur balise="p" focalisable ref={ref}>
        Corrigez les champs en rouge
      </ChampErreur>,
    );
    const el = screen.getByRole('alert');
    expect(el).toHaveAttribute('tabindex', '-1');
    ref.current?.focus();
    expect(el).toHaveFocus();
  });
});
