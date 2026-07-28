import {
  render,
  screen,
  waitFor,
  fireEvent,
  within,
} from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { TarifsPage } from './TarifsPage';
import type { GrilleAbcmVue } from '../types/bff';

vi.mock('../api/client', () => ({
  api: {
    listerGrilles: vi.fn(),
    publierGrille: vi.fn(),
  },
  // Ré-export d'ApiError (piège documenté) : la page lit `status`/`corps` pour
  // reconnaître le 409 PERIODE_CHEVAUCHANTE.
  ApiError: class ApiError extends Error {
    status: number;
    corps: unknown;
    constructor(status: number, corps: unknown) {
      super(`HTTP ${status}`);
      this.name = 'ApiError';
      this.status = status;
      this.corps = corps;
    }
  },
}));

import { api, ApiError } from '../api/client';

function ligne(overrides: Partial<GrilleAbcmVue> = {}): GrilleAbcmVue {
  return {
    id: 'g-1',
    tranche: 1,
    valideDu: '2026-01-01',
    valideAu: null,
    cantineTotalCentimes: 1050,
    cantinePartGardeCentimes: null,
    periMatinCentimes: 231,
    periSoirCentimes: 501,
    alshJourneeCompleteCentimes: 2350,
    alshDemiJourneeCentimes: 850,
    alshRepasCentimes: 650,
    ...overrides,
  };
}

function monter() {
  return render(
    <MemoryRouter initialEntries={['/tarifs']}>
      <TarifsPage />
    </MemoryRouter>,
  );
}

/** Remplit les 7 postes d'une tranche (les inputs sont dans l'ordre du DOM). */
function remplirTranches() {
  const inputs = screen.getAllByRole('spinbutton');
  inputs.forEach((input, i) => {
    fireEvent.change(input, { target: { value: String(i + 1) } });
  });
}

describe('TarifsPage', () => {
  beforeEach(() => {
    vi.mocked(api.listerGrilles).mockReset();
    vi.mocked(api.publierGrille).mockReset();
  });

  it('regroupe les grilles par période et affiche leur statut', async () => {
    vi.mocked(api.listerGrilles).mockResolvedValue([
      ligne({
        id: 'a',
        tranche: 1,
        valideDu: '2020-01-01',
        valideAu: '2020-12-31',
      }),
      ligne({
        id: 'b',
        tranche: 2,
        valideDu: '2020-01-01',
        valideAu: '2020-12-31',
      }),
    ]);

    monter();

    await waitFor(() => {
      expect(screen.getByText(/Grille du/)).toBeInTheDocument();
    });
    // Période entièrement passée → statut « passée ».
    expect(screen.getByText(/passée/)).toBeInTheDocument();
    // Les lignes de tranche vivent dans la carte de la grille (le formulaire a
    // aussi des légendes « Tranche N » → on scope à l'article pour lever l'ambiguïté).
    const article = screen.getByText(/Grille du/).closest('article');
    expect(article).not.toBeNull();
    expect(
      within(article as HTMLElement).getByText(/Tranche 1/),
    ).toBeInTheDocument();
    expect(
      within(article as HTMLElement).getByText(/Tranche 2/),
    ).toBeInTheDocument();
  });

  it('publie une grille et recharge la liste', async () => {
    vi.mocked(api.listerGrilles).mockResolvedValue([]);
    vi.mocked(api.publierGrille).mockResolvedValue([ligne()]);

    monter();
    await waitFor(() => {
      expect(screen.getByText(/Aucune grille enregistrée/)).toBeInTheDocument();
    });

    fireEvent.change(screen.getByLabelText('À partir du'), {
      target: { value: '2027-09-01' },
    });
    remplirTranches();
    fireEvent.click(screen.getByRole('button', { name: /Publier la grille/ }));

    await waitFor(() => {
      expect(api.publierGrille).toHaveBeenCalledOnce();
    });
    const corps = vi.mocked(api.publierGrille).mock.calls[0]?.[0];
    expect(corps?.valideDu).toBe('2027-09-01');
    expect(corps?.tranches).toHaveLength(3);
    expect(corps?.tranches[0]?.tranche).toBe(1);
  });

  it('affiche un message clair sur un 409 de chevauchement', async () => {
    vi.mocked(api.listerGrilles).mockResolvedValue([]);
    vi.mocked(api.publierGrille).mockRejectedValue(
      new ApiError(409, { code: 'PERIODE_CHEVAUCHANTE', message: 'x' }),
    );

    monter();
    await waitFor(() => {
      expect(screen.getByText(/Aucune grille enregistrée/)).toBeInTheDocument();
    });

    fireEvent.change(screen.getByLabelText('À partir du'), {
      target: { value: '2026-06-01' },
    });
    remplirTranches();
    fireEvent.click(screen.getByRole('button', { name: /Publier la grille/ }));

    await waitFor(() => {
      expect(screen.getByRole('alert').textContent).toMatch(/chevauche/i);
    });
  });
});
