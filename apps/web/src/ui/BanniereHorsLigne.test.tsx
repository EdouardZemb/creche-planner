import { render, screen, act } from '@testing-library/react';
import { describe, it, expect, afterEach } from 'vitest';
import { BanniereHorsLigne } from './BanniereHorsLigne';

function definirOnLine(valeur: boolean) {
  Object.defineProperty(navigator, 'onLine', {
    configurable: true,
    value: valeur,
  });
}

describe('BanniereHorsLigne', () => {
  afterEach(() => {
    definirOnLine(true);
  });

  it('ne rend rien quand le navigateur est en ligne', () => {
    definirOnLine(true);
    const { container } = render(<BanniereHorsLigne />);
    expect(container).toBeEmptyDOMElement();
  });

  it('affiche une région de statut hors-ligne, avec le texte exact', () => {
    definirOnLine(false);
    render(<BanniereHorsLigne />);
    const banniere = screen.getByRole('status');
    expect(banniere).toHaveClass('banniere-hors-ligne');
    expect(banniere).toHaveAttribute('aria-live', 'polite');
    expect(banniere).toHaveTextContent(
      'Vous êtes hors-ligne. Les informations affichées peuvent dater de votre dernière connexion.',
    );
  });

  it('apparaît sur « offline » puis disparaît sur « online »', () => {
    definirOnLine(true);
    render(<BanniereHorsLigne />);
    expect(screen.queryByRole('status')).toBeNull();

    act(() => {
      window.dispatchEvent(new Event('offline'));
    });
    expect(screen.getByRole('status')).toBeInTheDocument();

    act(() => {
      window.dispatchEvent(new Event('online'));
    });
    expect(screen.queryByRole('status')).toBeNull();
  });
});
