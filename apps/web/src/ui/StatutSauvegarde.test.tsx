import { render, screen } from '@testing-library/react';
import { describe, it, expect } from 'vitest';
import { StatutSauvegarde } from './StatutSauvegarde';

describe('StatutSauvegarde', () => {
  it("ne rend rien à l'état idle", () => {
    const { container } = render(<StatutSauvegarde etat="idle" />);
    expect(container).toBeEmptyDOMElement();
  });

  it('affiche « Enregistré » avec un role status', () => {
    render(<StatutSauvegarde etat="enregistre" />);
    const el = screen.getByRole('status');
    expect(el).toHaveTextContent('Enregistré');
    expect(el).toHaveClass('statut-enregistre');
  });

  it("affiche l'erreur d'enregistrement", () => {
    render(<StatutSauvegarde etat="erreur" />);
    const el = screen.getByRole('status');
    expect(el).toHaveTextContent("Erreur d'enregistrement");
    expect(el).toHaveClass('statut-erreur');
  });
});
