import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect } from 'vitest';
import { useAnnonce } from './useAnnonce';

// Composant de test qui câble le hook comme le font les calendriers : une
// région live sr-only et un déclencheur de mutation.
function Coquille({ message }: { message: string }) {
  const { annoncer, regionLiveProps } = useAnnonce();
  return (
    <div>
      <p data-testid="live" {...regionLiveProps} />
      <button type="button" onClick={() => annoncer(message)}>
        Muter
      </button>
    </div>
  );
}

describe('useAnnonce (AQ-05)', () => {
  it('expose une région live polite de rôle status', () => {
    render(<Coquille message="Absence ajoutée le 02/06/2026" />);
    const live = screen.getByTestId('live');
    expect(live).toHaveAttribute('role', 'status');
    expect(live).toHaveAttribute('aria-live', 'polite');
    expect(live).toHaveAttribute('aria-atomic', 'true');
  });

  it("n'annonce rien tant qu'aucune mutation n'a eu lieu", () => {
    render(<Coquille message="Absence ajoutée le 02/06/2026" />);
    expect(screen.getByTestId('live')).toHaveTextContent('');
  });

  it("publie le message dans la région à l'appel d'annoncer", () => {
    render(<Coquille message="Absence ajoutée le 02/06/2026" />);
    fireEvent.click(screen.getByRole('button', { name: 'Muter' }));
    expect(screen.getByTestId('live')).toHaveTextContent(
      'Absence ajoutée le 02/06/2026',
    );
  });

  it('force la relecture de deux annonces identiques consécutives (contenu DOM distinct)', () => {
    render(<Coquille message="Absence ajoutée le 02/06/2026" />);
    const bouton = screen.getByRole('button', { name: 'Muter' });

    fireEvent.click(bouton);
    const premier = screen.getByTestId('live').textContent;
    fireEvent.click(bouton);
    const second = screen.getByTestId('live').textContent;

    // Sans mutation du nœud texte, les lecteurs d'écran ignorent la seconde
    // annonce : le contenu brut doit différer (suffixe invisible alterné)…
    expect(second).not.toBe(premier);
    // … tout en restant le même message une fois normalisé.
    expect(screen.getByTestId('live')).toHaveTextContent(
      'Absence ajoutée le 02/06/2026',
    );
  });
});
