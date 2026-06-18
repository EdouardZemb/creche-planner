import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, it, expect } from 'vitest';
import { useState } from 'react';
import { Modale } from './Modale';

// Harnais : un bouton déclencheur qui ouvre la modale, pour vérifier la
// restauration du focus à la fermeture.
function Harnais({ onClose }: { onClose?: () => void }) {
  const [ouvert, setOuvert] = useState(false);
  const fermer = () => {
    setOuvert(false);
    onClose?.();
  };
  return (
    <div>
      <button
        type="button"
        onClick={() => {
          setOuvert(true);
        }}
      >
        Ouvrir
      </button>
      {ouvert && (
        <Modale titre="Saisir une absence" onClose={fermer}>
          <input aria-label="Durée" />
          <button type="button">Valider</button>
        </Modale>
      )}
    </div>
  );
}

describe('Modale', () => {
  it('expose role dialog, aria-modal et aria-labelledby', async () => {
    const user = userEvent.setup();
    render(<Harnais />);
    await user.click(screen.getByRole('button', { name: 'Ouvrir' }));

    const dialog = screen.getByRole('dialog');
    expect(dialog).toHaveAttribute('aria-modal', 'true');
    const labelId = dialog.getAttribute('aria-labelledby');
    expect(labelId).toBeTruthy();
    expect(document.getElementById(labelId!)).toHaveTextContent(
      'Saisir une absence',
    );
  });

  it("déplace le focus dans la modale à l'ouverture", async () => {
    const user = userEvent.setup();
    render(<Harnais />);
    await user.click(screen.getByRole('button', { name: 'Ouvrir' }));
    const dialog = screen.getByRole('dialog');
    // Le focus est sur un élément focusable interne (premier dans l'ordre DOM :
    // le bouton « Fermer » de l'en-tête).
    expect(dialog.contains(document.activeElement)).toBe(true);
    expect(screen.getByRole('button', { name: 'Fermer' })).toHaveFocus();
  });

  it('ferme sur Échap', async () => {
    const user = userEvent.setup();
    render(<Harnais />);
    await user.click(screen.getByRole('button', { name: 'Ouvrir' }));
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it("ferme au clic sur l'overlay", async () => {
    const user = userEvent.setup();
    render(<Harnais />);
    await user.click(screen.getByRole('button', { name: 'Ouvrir' }));
    const dialog = screen.getByRole('dialog');
    // L'overlay est le parent de la modale.
    const overlay = dialog.parentElement!;
    await user.click(overlay);
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it("ne ferme pas au clic à l'intérieur de la modale", async () => {
    const user = userEvent.setup();
    render(<Harnais />);
    await user.click(screen.getByRole('button', { name: 'Ouvrir' }));
    await user.click(screen.getByLabelText('Durée'));
    expect(screen.getByRole('dialog')).toBeInTheDocument();
  });

  it('restaure le focus sur le déclencheur à la fermeture', async () => {
    const user = userEvent.setup();
    render(<Harnais />);
    const declencheur = screen.getByRole('button', { name: 'Ouvrir' });
    await user.click(declencheur);
    await user.keyboard('{Escape}');
    expect(declencheur).toHaveFocus();
  });

  it('piège le focus (Tab depuis le dernier revient au premier)', async () => {
    const user = userEvent.setup();
    render(<Harnais />);
    await user.click(screen.getByRole('button', { name: 'Ouvrir' }));

    // Ordre DOM : Fermer (en-tête) → Durée → Valider (corps).
    const fermer = screen.getByRole('button', { name: 'Fermer' });
    const champ = screen.getByLabelText('Durée');
    const valider = screen.getByRole('button', { name: 'Valider' });

    expect(fermer).toHaveFocus();
    await user.tab();
    expect(champ).toHaveFocus();
    await user.tab();
    expect(valider).toHaveFocus();
    await user.tab();
    expect(fermer).toHaveFocus();
  });

  it('piège le focus (Shift+Tab depuis le premier va au dernier)', async () => {
    const user = userEvent.setup();
    render(<Harnais />);
    await user.click(screen.getByRole('button', { name: 'Ouvrir' }));

    const fermer = screen.getByRole('button', { name: 'Fermer' });
    const valider = screen.getByRole('button', { name: 'Valider' });

    expect(fermer).toHaveFocus();
    await user.tab({ shift: true });
    expect(valider).toHaveFocus();
  });
});
