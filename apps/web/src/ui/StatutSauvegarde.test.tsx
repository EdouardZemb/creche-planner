import { render, screen } from '@testing-library/react';
import { describe, it, expect } from 'vitest';
import { StatutSauvegarde } from './StatutSauvegarde';

describe('StatutSauvegarde', () => {
  it("ne rend rien à l'état idle", () => {
    const { container } = render(<StatutSauvegarde etat="idle" />);
    expect(container).toBeEmptyDOMElement();
  });

  it('affiche « Enregistrement… » pendant l’écriture (debounce compris)', () => {
    render(<StatutSauvegarde etat="en-cours" />);
    const el = screen.getByRole('status');
    expect(el).toHaveTextContent('Enregistrement…');
    expect(el).toHaveClass('statut-en-cours');
  });

  it('affiche « Enregistré » avec un role status', () => {
    render(<StatutSauvegarde etat="enregistre" />);
    const el = screen.getByRole('status');
    expect(el).toHaveTextContent('Enregistré');
    expect(el).toHaveClass('statut-enregistre');
  });

  it('horodate l’enregistrement quand l’heure est fournie', () => {
    render(<StatutSauvegarde etat="enregistre" enregistreA="21:43" />);
    expect(screen.getByRole('status')).toHaveTextContent('Enregistré à 21:43');
  });

  it("affiche l'erreur d'enregistrement", () => {
    render(<StatutSauvegarde etat="erreur" />);
    const el = screen.getByRole('status');
    expect(el).toHaveTextContent("Erreur d'enregistrement");
    expect(el).toHaveClass('statut-erreur');
  });
});
