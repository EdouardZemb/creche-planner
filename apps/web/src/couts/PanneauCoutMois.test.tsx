import { render, screen, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { PanneauCoutMois } from './PanneauCoutMois';
import { ApiError } from '../api/client';
import type { CoutMoisVue } from '../types/bff';

vi.mock('../api/client', () => ({
  api: {
    lireCoutMois: vi.fn(),
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

const coutMoisFactice: CoutMoisVue = {
  foyerId: 'foyer-1',
  mois: '2026-06',
  simule: false,
  totalCentimes: 35000,
  prestations: [
    {
      enfant: 'Emma',
      mode: 'CRECHE_PSU',
      totalCentimes: 35000,
      lignes: [
        { libelle: 'Mensualité crèche', sens: 'debit', montantCentimes: 40000 },
        { libelle: 'Aide CAF', sens: 'credit', montantCentimes: 5000 },
      ],
    },
  ],
  lignes: [{ libelle: 'Total net', sens: 'debit', montantCentimes: 35000 }],
};

const coutMoisSimuleFactice: CoutMoisVue = {
  ...coutMoisFactice,
  simule: true,
  totalCentimes: 30000,
  prestations: [
    {
      enfant: 'Emma',
      mode: 'CRECHE_PSU',
      totalCentimes: 30000,
      lignes: [
        { libelle: 'Mensualité crèche', sens: 'debit', montantCentimes: 35000 },
        { libelle: 'Aide CAF', sens: 'credit', montantCentimes: 5000 },
      ],
    },
  ],
  lignes: [{ libelle: 'Total net', sens: 'debit', montantCentimes: 30000 }],
};

describe('PanneauCoutMois', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('affiche le chargement initialement', () => {
    vi.mocked(api.lireCoutMois).mockReturnValue(new Promise(() => undefined));

    render(<PanneauCoutMois foyerId="foyer-1" mois="2026-06" simule={false} />);

    expect(screen.getByText(/Chargement du coût du mois/i)).toBeInTheDocument();
  });

  it('affiche le total et les prestations après chargement', async () => {
    vi.mocked(api.lireCoutMois).mockResolvedValue(coutMoisFactice);

    render(<PanneauCoutMois foyerId="foyer-1" mois="2026-06" simule={false} />);

    await waitFor(() => {
      expect(screen.getAllByText(/350,00/).length).toBeGreaterThan(0);
    });

    expect(screen.getByText(/Emma/)).toBeInTheDocument();
    // EX-13 : libellé de mode accentué, jamais le code brut « CRECHE_PSU ».
    // UX lot 2 : le sigle « PSU » (jargon de financement) n'apparaît plus non plus.
    expect(screen.getByText(/Crèche/)).toBeInTheDocument();
    expect(screen.queryByText('PSU')).not.toBeInTheDocument();
    expect(screen.queryByText('CRECHE_PSU')).not.toBeInTheDocument();
    expect(screen.getByText(/Mensualité crèche/)).toBeInTheDocument();
    expect(screen.getByText(/Aide CAF/)).toBeInTheDocument();
    expect(screen.getByText(/Total net/)).toBeInTheDocument();
  });

  it('affiche les lignes avec les classes debit/credit correctes', async () => {
    vi.mocked(api.lireCoutMois).mockResolvedValue(coutMoisFactice);

    render(<PanneauCoutMois foyerId="foyer-1" mois="2026-06" simule={false} />);

    await screen.findByText(/Mensualité crèche/);

    const debitSpan = screen
      .getAllByText(/400,00/)
      .find((el) => el.classList.contains('debit'));
    expect(debitSpan).toBeTruthy();

    const creditSpan = screen
      .getAllByText(/50,00/)
      .find((el) => el.classList.contains('credit'));
    expect(creditSpan).toBeTruthy();
  });

  it("affiche un message d'erreur en cas de rejet", async () => {
    vi.mocked(api.lireCoutMois).mockRejectedValue(
      new Error('Serveur indisponible'),
    );

    render(<PanneauCoutMois foyerId="foyer-1" mois="2026-06" simule={false} />);

    await waitFor(() => {
      expect(screen.getByRole('alert')).toBeInTheDocument();
    });

    expect(screen.getByText(/Serveur indisponible/)).toBeInTheDocument();
  });

  it('calcule et affiche le delta en mode simulation', async () => {
    // simule=true : lireCoutMois appelé 2x (simule et reel)
    vi.mocked(api.lireCoutMois)
      .mockResolvedValueOnce(coutMoisSimuleFactice) // simule=true
      .mockResolvedValueOnce(coutMoisFactice); // simule=false (réel)

    render(<PanneauCoutMois foyerId="foyer-1" mois="2026-06" simule />);

    await waitFor(() => {
      // Simulé = 300 €, réel = 350 €, delta = -50 € (économie)
      expect(screen.getByText(/-50,00/)).toBeInTheDocument();
    });
  });

  it('affiche delta en vert pour une économie (delta < 0)', async () => {
    vi.mocked(api.lireCoutMois)
      .mockResolvedValueOnce(coutMoisSimuleFactice) // 300 €
      .mockResolvedValueOnce(coutMoisFactice); // 350 €

    render(<PanneauCoutMois foyerId="foyer-1" mois="2026-06" simule />);

    await screen.findByText(/-50,00/);

    const deltaEl = screen.getByText(/-50,00/);
    expect(deltaEl).toHaveStyle({ color: 'var(--vert)' });
  });

  // UT-08 — sigles métier explicités (nom accessible via Abbr). Le mode crèche
  // ne porte plus de sigle (« Crèche » tout court, UX lot 2) : on vérifie le
  // mécanisme `avecSigles` sur « ALSH », seul mode dont le libellé reste un sigle.
  it('explicite le sigle « ALSH » du libellé de mode (UT-08)', async () => {
    vi.mocked(api.lireCoutMois).mockResolvedValue({
      ...coutMoisFactice,
      prestations: [
        {
          enfant: 'Emma',
          mode: 'ALSH',
          totalCentimes: 35000,
          lignes: [],
        },
      ],
    });

    render(<PanneauCoutMois foyerId="foyer-1" mois="2026-06" simule={false} />);

    await screen.findByText(/Emma/);
    // <abbr> dont le titre expose le libellé long du glossaire
    const abbr = document.querySelector('abbr[title]');
    expect(abbr).toBeTruthy();
    expect(abbr?.textContent).toBe('ALSH');
    expect(abbr?.getAttribute('title')).toMatch(
      /Accueil de loisirs sans hébergement/i,
    );
    // atteignable au clavier
    expect(abbr).toHaveAttribute('tabindex', '0');
  });

  // Lot 2 qualité Coûts — la pseudo-prestation des frais fixes annuels ABCM
  // (septembre) s'affiche en langage parent, jamais le code brut.
  it('affiche « Frais annuels — ABCM » pour la pseudo-prestation des frais fixes', async () => {
    vi.mocked(api.lireCoutMois).mockResolvedValue({
      ...coutMoisFactice,
      mois: '2026-09',
      prestations: [
        {
          enfant: '',
          mode: 'FRAIS_FIXES_ABCM',
          totalCentimes: 43600,
          lignes: [
            {
              libelle: 'Cotisation annuelle',
              sens: 'debit',
              montantCentimes: 28600,
            },
            {
              libelle: 'Frais de 1ère inscription',
              sens: 'debit',
              montantCentimes: 15000,
            },
          ],
        },
      ],
    });

    render(<PanneauCoutMois foyerId="foyer-1" mois="2026-09" simule={false} />);

    // Titre de section « Frais annuels — ABCM », sans prénom ni code brut.
    await screen.findByText(/Frais annuels/);
    expect(screen.queryByText(/FRAIS_FIXES_ABCM/)).not.toBeInTheDocument();
    // Le sigle « ABCM » reste explicité via le glossaire (Abbr).
    const abbr = document.querySelector('abbr[title]');
    expect(abbr).toBeTruthy();
    expect(abbr?.textContent).toBe('ABCM');
    expect(abbr?.getAttribute('title')).toMatch(/Association des bénévoles/i);
  });

  // UT-09 CA2 — repère NON COLORÉ du delta (économie)
  it('ajoute un repère non coloré « économie » au delta négatif (UT-09)', async () => {
    vi.mocked(api.lireCoutMois)
      .mockResolvedValueOnce(coutMoisSimuleFactice) // 300 €
      .mockResolvedValueOnce(coutMoisFactice); // 350 €

    render(<PanneauCoutMois foyerId="foyer-1" mois="2026-06" simule />);

    await screen.findByText(/-50,00/);
    // symbole non coloré ▼ + libellé textuel « économie » (hors couleur)
    expect(screen.getByText('▼')).toBeInTheDocument();
    expect(screen.getByText(/\(économie\)/)).toBeInTheDocument();
  });

  // UT-09 CA2 — cas d'ÉGALITÉ (delta = 0) doit rester distinguable sans couleur
  it('ajoute un repère non coloré « identique » quand le delta est nul (UT-09)', async () => {
    vi.mocked(api.lireCoutMois)
      .mockResolvedValueOnce(coutMoisSimuleFactice) // 300 €
      .mockResolvedValueOnce(coutMoisSimuleFactice); // 300 € → delta = 0

    render(<PanneauCoutMois foyerId="foyer-1" mois="2026-06" simule />);

    await screen.findByText('=');
    expect(screen.getByText('=')).toBeInTheDocument();
    expect(screen.getByText(/\(identique\)/)).toBeInTheDocument();
  });

  it('re-fetch quand version change', async () => {
    vi.mocked(api.lireCoutMois).mockResolvedValue(coutMoisFactice);

    const { rerender } = render(
      <PanneauCoutMois
        foyerId="foyer-1"
        mois="2026-06"
        simule={false}
        version={0}
      />,
    );

    await screen.findAllByText(/350,00/);
    const appels1 = vi.mocked(api.lireCoutMois).mock.calls.length;

    rerender(
      <PanneauCoutMois
        foyerId="foyer-1"
        mois="2026-06"
        simule={false}
        version={1}
      />,
    );

    await waitFor(() => {
      expect(vi.mocked(api.lireCoutMois).mock.calls.length).toBeGreaterThan(
        appels1,
      );
    });
  });

  it('affiche "simulation" dans le titre quand simule=true', async () => {
    vi.mocked(api.lireCoutMois).mockResolvedValue(coutMoisSimuleFactice);

    render(<PanneauCoutMois foyerId="foyer-1" mois="2026-06" simule />);

    await screen.findByText(/simulation/i);
    expect(screen.getByText(/simulation/i)).toBeInTheDocument();
  });

  it('affiche un message clair sur erreur 502 (service indisponible)', async () => {
    vi.mocked(api.lireCoutMois).mockRejectedValue(new ApiError(502, undefined));

    render(<PanneauCoutMois foyerId="foyer-1" mois="2026-06" simule={false} />);

    await waitFor(() => {
      expect(screen.getByRole('alert')).toBeInTheDocument();
    });
    expect(screen.getByText(/Service indisponible/i)).toBeInTheDocument();
  });

  it('affiche les boutons export CSV et PDF', async () => {
    vi.mocked(api.lireCoutMois).mockResolvedValue(coutMoisFactice);

    render(<PanneauCoutMois foyerId="foyer-1" mois="2026-06" simule={false} />);

    await screen.findByText(/Total net/);
    expect(
      screen.getByRole('button', { name: /Exporter.*CSV/i }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: /Imprimer.*PDF/i }),
    ).toBeInTheDocument();
  });

  it('le bouton Exporter CSV déclenche un téléchargement Blob', async () => {
    vi.mocked(api.lireCoutMois).mockResolvedValue(coutMoisFactice);
    const createUrl = vi.fn(() => 'blob:fake');
    URL.createObjectURL = createUrl;
    URL.revokeObjectURL = vi.fn() as typeof URL.revokeObjectURL;
    const click = vi
      .spyOn(HTMLAnchorElement.prototype, 'click')
      .mockImplementation(() => undefined);

    render(<PanneauCoutMois foyerId="foyer-1" mois="2026-06" simule={false} />);

    const bouton = await screen.findByRole('button', {
      name: /Exporter.*CSV/i,
    });
    bouton.click();

    expect(createUrl).toHaveBeenCalledTimes(1);
    expect(click).toHaveBeenCalledTimes(1);
    vi.restoreAllMocks();
  });
});
