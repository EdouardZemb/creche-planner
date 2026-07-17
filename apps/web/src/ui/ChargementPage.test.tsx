import { render, screen } from '@testing-library/react';
import { describe, it, expect } from 'vitest';
import { ChargementPage } from './ChargementPage';

describe('ChargementPage', () => {
  it('annonce le message dans une région de statut polie', () => {
    render(<ChargementPage message="Chargement de votre profil…" />);
    const region = screen.getByRole('status');
    expect(region).toHaveTextContent('Chargement de votre profil…');
    expect(region).toHaveAttribute('aria-live', 'polite');
  });

  it('rend la roue décorative, masquée aux lecteurs d’écran', () => {
    const { container } = render(<ChargementPage message="Chargement…" />);
    const roue = container.querySelector('.spinner-roue');
    expect(roue).not.toBeNull();
    expect(roue).toHaveAttribute('aria-hidden', 'true');
  });
});
