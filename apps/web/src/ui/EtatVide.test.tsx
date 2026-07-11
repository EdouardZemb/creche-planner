import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { describe, it, expect, vi } from 'vitest';
import { EtatVide, type EtatVideProps } from './EtatVide';

// `EtatVide` rend désormais les actions `href` internes en `<Link>` (navigation
// SPA) : il faut un routeur pour le monter.
function rendre(props: EtatVideProps, initial = '/') {
  return render(
    <MemoryRouter initialEntries={[initial]}>
      <Routes>
        <Route path="/" element={<EtatVide {...props} />} />
        <Route path="/cible" element={<div>CIBLE ATTEINTE</div>} />
      </Routes>
    </MemoryRouter>,
  );
}

describe('EtatVide', () => {
  it('rend le titre et la description', () => {
    rendre({ titre: 'Aucun contrat', description: 'Commencez ici.' });
    expect(
      screen.getByRole('heading', { name: 'Aucun contrat' }),
    ).toBeInTheDocument();
    expect(screen.getByText('Commencez ici.')).toBeInTheDocument();
  });

  it('rend une action lien avec href', () => {
    rendre({
      titre: 'Vide',
      actions: [{ libelle: 'Créer un contrat', href: '/foyers/f1/contrats' }],
    });
    const lien = screen.getByRole('link', { name: 'Créer un contrat' });
    expect(lien).toHaveAttribute('href', '/foyers/f1/contrats');
  });

  it('rend une action bouton et déclenche onClick', async () => {
    const user = userEvent.setup();
    const onClick = vi.fn();
    rendre({ titre: 'Erreur', actions: [{ libelle: 'Réessayer', onClick }] });
    await user.click(screen.getByRole('button', { name: 'Réessayer' }));
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it('rend plusieurs actions', () => {
    rendre({
      titre: 'Famille introuvable',
      actions: [
        { libelle: 'Créer une nouvelle famille', href: '/foyers/new' },
        { libelle: 'Revenir à ma famille', href: '/foyers/f1/planning' },
      ],
    });
    expect(screen.getAllByRole('link')).toHaveLength(2);
  });

  it('href interne (/…) : navigation SPA via <Link>, sans rechargement complet', async () => {
    const user = userEvent.setup();
    rendre({ titre: 'Vide', actions: [{ libelle: 'Aller', href: '/cible' }] });

    // Le clic reste intercepté par le routeur (transition client) : le contenu
    // de la route cible apparaît sans quitter l'app.
    await user.click(screen.getByRole('link', { name: 'Aller' }));
    expect(screen.getByText('CIBLE ATTEINTE')).toBeInTheDocument();
  });

  it('href externe : rendue en <a href> classique (pas de <Link>)', () => {
    rendre({
      titre: 'Aide',
      actions: [{ libelle: 'Doc', href: 'https://exemple.test/aide' }],
    });
    const lien = screen.getByRole('link', { name: 'Doc' });
    expect(lien).toHaveAttribute('href', 'https://exemple.test/aide');
    // Un `<a>` nu n'intercepte pas le clic (contrairement à un `<Link>`).
    const ev = new MouseEvent('click', {
      bubbles: true,
      cancelable: true,
      button: 0,
    });
    lien.dispatchEvent(ev);
    expect(ev.defaultPrevented).toBe(false);
  });

  it('href interne + rechargement : forcée en <a href> (rechargement complet)', () => {
    rendre({
      titre: 'Session expirée',
      actions: [
        { libelle: 'Se reconnecter', href: '/cible', rechargement: true },
      ],
    });
    const lien = screen.getByRole('link', { name: 'Se reconnecter' });
    expect(lien).toHaveAttribute('href', '/cible');
    // `rechargement` force un `<a>` nu : le clic n'est PAS intercepté par le
    // routeur (pas de transition SPA), il partirait en navigation réseau réelle.
    const ev = new MouseEvent('click', {
      bubbles: true,
      cancelable: true,
      button: 0,
    });
    lien.dispatchEvent(ev);
    expect(ev.defaultPrevented).toBe(false);
    expect(screen.queryByText('CIBLE ATTEINTE')).not.toBeInTheDocument();
  });
});
