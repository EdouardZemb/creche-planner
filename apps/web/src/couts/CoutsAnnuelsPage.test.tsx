import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { CoutsAnnuelsPage } from './CoutsAnnuelsPage';
import { ApiError } from '../api/client';
import type { CoutAnnuelVue } from '../types/bff';

vi.mock('../api/client', () => ({
  api: {
    lireCoutAnnuel: vi.fn(),
  },
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

import { api } from '../api/client';

const coutAnnuelFactice: CoutAnnuelVue = {
  foyerId: 'foyer-1',
  annee: 2026,
  simule: false,
  totalCentimes: 420000,
  mois: [
    {
      foyerId: 'foyer-1',
      mois: '2026-01',
      simule: false,
      totalCentimes: 35000,
      prestations: [],
      lignes: [],
    },
    {
      foyerId: 'foyer-1',
      mois: '2026-02',
      simule: false,
      totalCentimes: 35000,
      prestations: [],
      lignes: [],
    },
  ],
};

const coutAnnuelSimuleFactice: CoutAnnuelVue = {
  ...coutAnnuelFactice,
  simule: true,
  totalCentimes: 380000,
  mois: [
    {
      foyerId: 'foyer-1',
      mois: '2026-01',
      simule: true,
      totalCentimes: 30000,
      prestations: [],
      lignes: [],
    },
    {
      foyerId: 'foyer-1',
      mois: '2026-02',
      simule: true,
      totalCentimes: 32000,
      prestations: [],
      lignes: [],
    },
  ],
};

function renderPage(foyerId = 'foyer-1', search = '') {
  return render(
    <MemoryRouter initialEntries={[`/foyers/${foyerId}/couts${search}`]}>
      <Routes>
        <Route path="/foyers/:foyerId/couts" element={<CoutsAnnuelsPage />} />
      </Routes>
    </MemoryRouter>,
  );
}

describe('CoutsAnnuelsPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('affiche le chargement initialement', () => {
    vi.mocked(api.lireCoutAnnuel).mockReturnValue(new Promise(() => undefined));

    renderPage();

    expect(
      screen.getByText(/Chargement des coûts annuels/i),
    ).toBeInTheDocument();
  });

  it('affiche le tableau avec les mois après chargement', async () => {
    vi.mocked(api.lireCoutAnnuel).mockResolvedValue(coutAnnuelFactice);

    renderPage();

    await waitFor(() => {
      expect(screen.getByText(/janvier 2026/i)).toBeInTheDocument();
    });

    expect(screen.getByText(/février 2026/i)).toBeInTheDocument();
    // Total annuel = 4 200,00 €
    expect(screen.getByText(/4 200,00/)).toBeInTheDocument();
  });

  it('expose un titre de niveau 1 « Coûts annuels » (EX-10)', async () => {
    vi.mocked(api.lireCoutAnnuel).mockResolvedValue(coutAnnuelFactice);

    renderPage();

    const titre = await screen.findByRole('heading', {
      level: 1,
      name: /Coûts annuels/i,
    });
    expect(titre).toBeInTheDocument();
  });

  it("met à jour le titre de l'onglet (EX-05)", async () => {
    vi.mocked(api.lireCoutAnnuel).mockResolvedValue(coutAnnuelFactice);

    renderPage();

    await screen.findByText(/janvier 2026/i);
    expect(document.title).toMatch(/Coûts annuels/);
  });

  it('porte scope="col" sur les en-têtes de colonnes (EX-16)', async () => {
    vi.mocked(api.lireCoutAnnuel).mockResolvedValue(coutAnnuelFactice);

    renderPage();

    await screen.findByText(/janvier 2026/i);
    const enteteMois = screen.getByRole('columnheader', { name: /^Mois$/i });
    expect(enteteMois).toHaveAttribute('scope', 'col');
  });

  it('expose chaque mois comme en-tête de ligne scope="row" (EX-16)', async () => {
    vi.mocked(api.lireCoutAnnuel).mockResolvedValue(coutAnnuelFactice);

    renderPage();

    const moisLigne = await screen.findByRole('rowheader', {
      name: /janvier 2026/i,
    });
    expect(moisLigne).toHaveAttribute('scope', 'row');
  });

  it('affiche le total annuel en pied de tableau', async () => {
    vi.mocked(api.lireCoutAnnuel).mockResolvedValue(coutAnnuelFactice);

    renderPage();

    await screen.findByText(/Total annuel/i);
    expect(screen.getByText(/Total annuel/i)).toBeInTheDocument();
  });

  it("affiche un message d'erreur si l'API échoue", async () => {
    vi.mocked(api.lireCoutAnnuel).mockRejectedValue(
      new Error('API unavailable'),
    );

    renderPage();

    await waitFor(() => {
      expect(screen.getByRole('alert')).toBeInTheDocument();
    });

    expect(screen.getByText(/API unavailable/)).toBeInTheDocument();
  });

  it('affiche SIMULATION quand ?simule=true', async () => {
    vi.mocked(api.lireCoutAnnuel)
      .mockResolvedValueOnce(coutAnnuelSimuleFactice) // simule=true
      .mockResolvedValueOnce(coutAnnuelFactice); // simule=false (réel)

    renderPage('foyer-1', '?simule=true');

    await screen.findByText('SIMULATION');
    expect(screen.getByText('SIMULATION')).toBeInTheDocument();
  });

  it('affiche les colonnes delta et réel en mode simulation', async () => {
    vi.mocked(api.lireCoutAnnuel)
      .mockResolvedValueOnce(coutAnnuelSimuleFactice)
      .mockResolvedValueOnce(coutAnnuelFactice);

    renderPage('foyer-1', '?simule=true');

    await screen.findByRole('columnheader', { name: /Total simulé/i });
    expect(
      screen.getByRole('columnheader', { name: /Total réel/i }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole('columnheader', { name: /Delta/i }),
    ).toBeInTheDocument();
  });

  // Lot 1 — vue simulation mobile : une carte par mois (Simulé/Réel/Delta)
  // + carte de synthèse « Total annuel » (la bascule table/cartes est en CSS,
  // les deux structures coexistent dans le DOM).
  it('rend une liste de cartes par mois en mode simulation', async () => {
    vi.mocked(api.lireCoutAnnuel)
      .mockResolvedValueOnce(coutAnnuelSimuleFactice)
      .mockResolvedValueOnce(coutAnnuelFactice);

    renderPage('foyer-1', '?simule=true');

    await screen.findByRole('heading', { level: 2, name: /janvier 2026/i });
    expect(
      screen.getByRole('heading', { level: 2, name: /février 2026/i }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole('heading', { level: 2, name: /Total annuel/i }),
    ).toBeInTheDocument();
    // Chaque carte porte les trois lignes libellées (janvier, février, total).
    expect(screen.getAllByText(/Total simulé/i).length).toBeGreaterThanOrEqual(
      3,
    );
    expect(screen.getAllByText(/Total réel/i).length).toBeGreaterThanOrEqual(3);
    expect(screen.getAllByText(/^Delta$/).length).toBeGreaterThanOrEqual(3);
  });

  it('ne rend pas la liste de cartes en vue normale', async () => {
    vi.mocked(api.lireCoutAnnuel).mockResolvedValue(coutAnnuelFactice);

    renderPage();

    await screen.findByText(/janvier 2026/i);
    expect(
      screen.queryByRole('heading', { level: 2, name: /Total annuel/i }),
    ).not.toBeInTheDocument();
  });

  it('calcule les deltas par mois en mode simulation', async () => {
    vi.mocked(api.lireCoutAnnuel)
      .mockResolvedValueOnce(coutAnnuelSimuleFactice) // jan: 300 €, fev: 320 €
      .mockResolvedValueOnce(coutAnnuelFactice); // jan: 350 €, fev: 350 €

    renderPage('foyer-1', '?simule=true');

    // jan: 300 - 350 = -50 € (économie)
    await waitFor(() => {
      expect(screen.getAllByText(/-50,00/).length).toBeGreaterThan(0);
    });
  });

  // UT-09 CA2 — repère NON COLORÉ du delta (sens lisible sans couleur)
  it('ajoute des repères non colorés aux deltas (UT-09)', async () => {
    vi.mocked(api.lireCoutAnnuel)
      .mockResolvedValueOnce(coutAnnuelSimuleFactice) // jan: 300 €, fev: 320 €
      .mockResolvedValueOnce(coutAnnuelFactice); // jan: 350 €, fev: 350 €

    renderPage('foyer-1', '?simule=true');

    // jan: -50 € (économie ▼), fev: -30 € (économie ▼) — table + cartes mobiles
    await screen.findAllByText(/-50,00/);
    expect(screen.getAllByText('▼').length).toBeGreaterThan(0);
    expect(screen.getAllByText(/\(économie\)/).length).toBeGreaterThan(0);
  });

  // UT-09 CA2 — cas d'ÉGALITÉ (delta = 0) distinguable sans couleur
  it('ajoute un repère non coloré « identique » pour un delta nul (UT-09)', async () => {
    const simuleEgal: CoutAnnuelVue = {
      ...coutAnnuelSimuleFactice,
      totalCentimes: 70000,
      mois: [
        {
          foyerId: 'foyer-1',
          mois: '2026-01',
          simule: true,
          totalCentimes: 35000, // = réel → delta 0
          prestations: [],
          lignes: [],
        },
      ],
    };
    const reelEgal: CoutAnnuelVue = {
      ...coutAnnuelFactice,
      totalCentimes: 70000,
      mois: [
        {
          foyerId: 'foyer-1',
          mois: '2026-01',
          simule: false,
          totalCentimes: 35000,
          prestations: [],
          lignes: [],
        },
      ],
    };
    vi.mocked(api.lireCoutAnnuel)
      .mockResolvedValueOnce(simuleEgal)
      .mockResolvedValueOnce(reelEgal);

    renderPage('foyer-1', '?simule=true');

    // janvier apparaît dans la table ET la carte mobile
    await screen.findAllByText(/janvier 2026/i);
    // symbole « = » et libellé « identique » présents (ligne + total annuel)
    expect(screen.getAllByText('=').length).toBeGreaterThan(0);
    expect(screen.getAllByText(/\(identique\)/).length).toBeGreaterThan(0);
  });

  it('affiche le lien vers le planning', async () => {
    vi.mocked(api.lireCoutAnnuel).mockResolvedValue(coutAnnuelFactice);

    renderPage();

    await screen.findByText(/Voir le détail du planning/i);
    const lien = screen.getByRole('link', {
      name: /Voir le détail du planning/i,
    });
    expect(lien).toHaveAttribute('href', '/foyers/foyer-1/planning');
  });

  it('affiche un message clair sur erreur 502 et un bouton réessayer', async () => {
    vi.mocked(api.lireCoutAnnuel).mockRejectedValue(
      new ApiError(502, undefined),
    );

    renderPage();

    await waitFor(() => {
      expect(screen.getByRole('alert')).toBeInTheDocument();
    });
    expect(screen.getByText(/Service indisponible/i)).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: /Réessayer/i }),
    ).toBeInTheDocument();
  });

  it('affiche les boutons export CSV et PDF', async () => {
    vi.mocked(api.lireCoutAnnuel).mockResolvedValue(coutAnnuelFactice);

    renderPage();

    await screen.findByText(/janvier 2026/i);
    expect(
      screen.getByRole('button', { name: /Exporter.*CSV/i }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: /Imprimer.*PDF/i }),
    ).toBeInTheDocument();
  });

  it('le bouton Exporter CSV déclenche un téléchargement Blob', async () => {
    vi.mocked(api.lireCoutAnnuel).mockResolvedValue(coutAnnuelFactice);
    const createUrl = vi.fn(() => 'blob:fake');
    URL.createObjectURL = createUrl;
    URL.revokeObjectURL = vi.fn() as typeof URL.revokeObjectURL;
    const click = vi
      .spyOn(HTMLAnchorElement.prototype, 'click')
      .mockImplementation(() => undefined);

    renderPage();

    const bouton = await screen.findByRole('button', {
      name: /Exporter.*CSV/i,
    });
    bouton.click();

    expect(createUrl).toHaveBeenCalledTimes(1);
    expect(click).toHaveBeenCalledTimes(1);
    vi.restoreAllMocks();
  });

  // Lot 1 — l'année vit dans l'URL (?annee=) et se navigue par ◀/▶.
  it("lit l'année depuis l'URL (?annee=2027)", async () => {
    vi.mocked(api.lireCoutAnnuel).mockResolvedValue(coutAnnuelFactice);

    renderPage('foyer-1', '?annee=2027');

    await screen.findByText('2027');
    await waitFor(() => {
      const appels = vi.mocked(api.lireCoutAnnuel).mock.calls;
      expect(appels.some((c) => c[1] === 2027)).toBe(true);
    });
  });

  it("retombe sur l'année courante si ?annee est invalide", async () => {
    vi.mocked(api.lireCoutAnnuel).mockResolvedValue(coutAnnuelFactice);

    renderPage('foyer-1', '?annee=abc');

    const courante = new Date().getFullYear();
    await screen.findByText(String(courante));
    await waitFor(() => {
      const appels = vi.mocked(api.lireCoutAnnuel).mock.calls;
      expect(appels.some((c) => c[1] === courante)).toBe(true);
    });
  });

  it("passe à l'année suivante avec ▶ et refetch", async () => {
    vi.mocked(api.lireCoutAnnuel).mockResolvedValue(coutAnnuelFactice);

    renderPage('foyer-1', '?annee=2026');

    await screen.findByText(/janvier 2026/i);
    fireEvent.click(screen.getByRole('button', { name: 'Année suivante' }));

    await screen.findByText('2027');
    await waitFor(() => {
      const appels = vi.mocked(api.lireCoutAnnuel).mock.calls;
      expect(appels.some((c) => c[1] === 2027)).toBe(true);
    });
  });

  it("revient à l'année précédente avec ◀ et refetch", async () => {
    vi.mocked(api.lireCoutAnnuel).mockResolvedValue(coutAnnuelFactice);

    renderPage('foyer-1', '?annee=2026');

    await screen.findByText(/janvier 2026/i);
    fireEvent.click(screen.getByRole('button', { name: 'Année précédente' }));

    await screen.findByText('2025');
    await waitFor(() => {
      const appels = vi.mocked(api.lireCoutAnnuel).mock.calls;
      expect(appels.some((c) => c[1] === 2025)).toBe(true);
    });
  });

  it('désactive ◀ à la borne 2020', async () => {
    vi.mocked(api.lireCoutAnnuel).mockResolvedValue(coutAnnuelFactice);

    renderPage('foyer-1', '?annee=2020');

    await screen.findByText('2020');
    expect(
      screen.getByRole('button', { name: 'Année précédente' }),
    ).toBeDisabled();
    expect(
      screen.getByRole('button', { name: 'Année suivante' }),
    ).toBeEnabled();
  });

  it('désactive ▶ à la borne 2099', async () => {
    vi.mocked(api.lireCoutAnnuel).mockResolvedValue(coutAnnuelFactice);

    renderPage('foyer-1', '?annee=2099');

    await screen.findByText('2099');
    expect(
      screen.getByRole('button', { name: 'Année suivante' }),
    ).toBeDisabled();
    expect(
      screen.getByRole('button', { name: 'Année précédente' }),
    ).toBeEnabled();
  });
});
