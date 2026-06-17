import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, it, expect, vi } from 'vitest';
import { EtatVide } from './EtatVide';

describe('EtatVide', () => {
  it('rend le titre et la description', () => {
    render(<EtatVide titre="Aucun contrat" description="Commencez ici." />);
    expect(
      screen.getByRole('heading', { name: 'Aucun contrat' }),
    ).toBeInTheDocument();
    expect(screen.getByText('Commencez ici.')).toBeInTheDocument();
  });

  it('rend une action lien avec href', () => {
    render(
      <EtatVide
        titre="Vide"
        actions={[{ libelle: 'Créer un contrat', href: '/foyers/f1/contrats' }]}
      />,
    );
    const lien = screen.getByRole('link', { name: 'Créer un contrat' });
    expect(lien).toHaveAttribute('href', '/foyers/f1/contrats');
  });

  it('rend une action bouton et déclenche onClick', async () => {
    const user = userEvent.setup();
    const onClick = vi.fn();
    render(
      <EtatVide titre="Erreur" actions={[{ libelle: 'Réessayer', onClick }]} />,
    );
    await user.click(screen.getByRole('button', { name: 'Réessayer' }));
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it('rend plusieurs actions', () => {
    render(
      <EtatVide
        titre="Foyer introuvable"
        actions={[
          { libelle: 'Créer un nouveau foyer', href: '/foyers/new' },
          { libelle: 'Revenir à mon foyer', href: '/foyers/f1/planning' },
        ]}
      />,
    );
    expect(screen.getAllByRole('link')).toHaveLength(2);
  });
});
