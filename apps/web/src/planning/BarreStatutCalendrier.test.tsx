import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, it, expect, vi } from 'vitest';
import { BarreStatutCalendrier } from './BarreStatutCalendrier';

function rendre(
  surcharges: Partial<Parameters<typeof BarreStatutCalendrier>[0]> = {},
) {
  return render(
    <BarreStatutCalendrier
      etat="idle"
      enregistreA={null}
      erreur={null}
      onReessayer={vi.fn()}
      erreurDurable={null}
      {...surcharges}
    />,
  );
}

describe('BarreStatutCalendrier', () => {
  it('affiche le statut « en-cours » (couvre le trou debounce → réponse)', () => {
    rendre({ etat: 'en-cours' });
    expect(screen.getByRole('status')).toHaveTextContent('Enregistrement…');
    expect(
      screen.queryByRole('button', { name: 'Réessayer' }),
    ).not.toBeInTheDocument();
  });

  it('affiche « Enregistré à hh:mm » persistant, sans bouton Réessayer', () => {
    rendre({ etat: 'enregistre', enregistreA: '21:43' });
    expect(screen.getByRole('status')).toHaveTextContent('Enregistré à 21:43');
    expect(
      screen.queryByRole('button', { name: 'Réessayer' }),
    ).not.toBeInTheDocument();
  });

  it('sur erreur : badge, détail et bouton « Réessayer » qui rejoue l’écriture', async () => {
    const user = userEvent.setup();
    const onReessayer = vi.fn();
    rendre({ etat: 'erreur', erreur: 'panne ciblée', onReessayer });

    expect(screen.getByRole('status')).toHaveTextContent(
      "Erreur d'enregistrement",
    );
    expect(screen.getByText('panne ciblée')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Réessayer' }));
    expect(onReessayer).toHaveBeenCalledTimes(1);
  });

  it('affiche l’erreur durable (PUT contrat) en alerte', () => {
    rendre({ erreurDurable: 'contrat refusé' });
    expect(screen.getByRole('alert')).toHaveTextContent('contrat refusé');
  });

  it('affiche la confirmation d’une modification durable aboutie (UX lot 4)', () => {
    rendre({ succesDurable: 'Contrat modifié à 21:43. Saisies effacées.' });
    expect(
      screen.getByText('Contrat modifié à 21:43. Saisies effacées.'),
    ).toBeInTheDocument();
  });
});
