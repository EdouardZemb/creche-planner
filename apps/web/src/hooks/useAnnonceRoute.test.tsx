import { render, screen, act } from '@testing-library/react';
import { describe, it, expect } from 'vitest';
import { MemoryRouter, Routes, Route, useNavigate } from 'react-router-dom';
import { useAnnonceRoute } from './useAnnonceRoute';

// Composant de test qui câble le hook comme le fera App.tsx (Lot 2) : une cible
// focusable (tabindex=-1), une région live, et un déclencheur de navigation.
function Coquille({ titre }: { titre: string }) {
  const { refCible, regionLiveProps } =
    useAnnonceRoute<HTMLHeadingElement>(titre);
  const navigate = useNavigate();
  return (
    <div>
      <p data-testid="live" {...regionLiveProps} />
      <h1 tabIndex={-1} ref={refCible}>
        {titre}
      </h1>
      <button type="button" onClick={() => navigate('/couts')}>
        Aller aux coûts
      </button>
    </div>
  );
}

function App() {
  return (
    <MemoryRouter initialEntries={['/planning']}>
      <Routes>
        <Route path="/planning" element={<Coquille titre="Planning" />} />
        <Route path="/couts" element={<Coquille titre="Coûts annuels" />} />
      </Routes>
    </MemoryRouter>
  );
}

describe('useAnnonceRoute', () => {
  it('expose une région live polite', () => {
    render(<App />);
    const live = screen.getByTestId('live');
    expect(live).toHaveAttribute('aria-live', 'polite');
    expect(live).toHaveAttribute('role', 'status');
  });

  it("n'annonce rien et ne bouge pas le focus au premier rendu", () => {
    render(<App />);
    expect(screen.getByTestId('live')).toHaveTextContent('');
    expect(screen.getByRole('heading', { name: 'Planning' })).not.toHaveFocus();
  });

  it('déplace le focus sur la cible au changement de pathname', async () => {
    render(<App />);
    await act(async () => {
      screen.getByRole('button', { name: 'Aller aux coûts' }).click();
    });
    expect(
      screen.getByRole('heading', { name: 'Coûts annuels' }),
    ).toHaveFocus();
  });

  it('annonce le titre de la nouvelle page au changement de route', async () => {
    render(<App />);
    await act(async () => {
      screen.getByRole('button', { name: 'Aller aux coûts' }).click();
    });
    expect(screen.getByTestId('live')).toHaveTextContent('Coûts annuels');
  });
});
