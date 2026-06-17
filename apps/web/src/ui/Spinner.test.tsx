import { render, screen } from '@testing-library/react';
import { describe, it, expect } from 'vitest';
import { Spinner } from './Spinner';

describe('Spinner', () => {
  it('expose un role status avec le label par défaut', () => {
    render(<Spinner />);
    const statut = screen.getByRole('status');
    expect(statut).toBeInTheDocument();
    expect(statut).toHaveTextContent('Chargement…');
  });

  it('accepte un label personnalisé', () => {
    render(<Spinner label="Calcul en cours" />);
    expect(screen.getByRole('status')).toHaveTextContent('Calcul en cours');
  });
});
