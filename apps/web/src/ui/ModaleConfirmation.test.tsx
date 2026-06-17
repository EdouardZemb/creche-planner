import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, it, expect, vi } from 'vitest';
import { ModaleConfirmation } from './ModaleConfirmation';

function rendre(props?: Partial<Parameters<typeof ModaleConfirmation>[0]>) {
  const onConfirmer = vi.fn();
  const onAnnuler = vi.fn();
  render(
    <ModaleConfirmation
      ouvert
      titre="Supprimer le contrat ?"
      message="Cette action est irréversible."
      libelleConfirmer="Supprimer le contrat"
      onConfirmer={onConfirmer}
      onAnnuler={onAnnuler}
      destructif
      {...props}
    />,
  );
  return { onConfirmer, onAnnuler };
}

describe('ModaleConfirmation', () => {
  it('ne rend rien quand ouvert est faux', () => {
    render(
      <ModaleConfirmation
        ouvert={false}
        titre="X"
        message="Y"
        libelleConfirmer="OK"
        onConfirmer={vi.fn()}
        onAnnuler={vi.fn()}
      />,
    );
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('affiche titre, message et les libellés des deux actions', () => {
    rendre();
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    expect(
      screen.getByRole('heading', { name: 'Supprimer le contrat ?' }),
    ).toBeInTheDocument();
    expect(
      screen.getByText('Cette action est irréversible.'),
    ).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: 'Supprimer le contrat' }),
    ).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Annuler' })).toBeInTheDocument();
  });

  it('porte le focus initial sur « Annuler »', async () => {
    rendre();
    expect(screen.getByRole('button', { name: 'Annuler' })).toHaveFocus();
  });

  it("déclenche onConfirmer au clic sur l'action primaire", async () => {
    const user = userEvent.setup();
    const { onConfirmer, onAnnuler } = rendre();
    await user.click(
      screen.getByRole('button', { name: 'Supprimer le contrat' }),
    );
    expect(onConfirmer).toHaveBeenCalledTimes(1);
    expect(onAnnuler).not.toHaveBeenCalled();
  });

  it('déclenche onAnnuler au clic sur « Annuler »', async () => {
    const user = userEvent.setup();
    const { onAnnuler } = rendre();
    await user.click(screen.getByRole('button', { name: 'Annuler' }));
    expect(onAnnuler).toHaveBeenCalledTimes(1);
  });

  it('déclenche onAnnuler sur Échap (hérité de Modale)', async () => {
    const user = userEvent.setup();
    const { onAnnuler } = rendre();
    await user.keyboard('{Escape}');
    expect(onAnnuler).toHaveBeenCalledTimes(1);
  });

  it('marque le bouton primaire en danger quand destructif', () => {
    rendre({ destructif: true });
    expect(
      screen.getByRole('button', { name: 'Supprimer le contrat' }),
    ).toHaveClass('danger');
  });
});
