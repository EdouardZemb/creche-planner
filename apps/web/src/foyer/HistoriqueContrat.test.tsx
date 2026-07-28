import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { vi, describe, it, expect, beforeEach } from 'vitest';
import { HistoriqueContrat } from './HistoriqueContrat';
import type { ContratVersionVue } from '../types/bff';

vi.mock('../api/client', () => ({
  api: { listerVersions: vi.fn() },
  ApiError: class ApiError extends Error {},
}));

import { api } from '../api/client';

const mockedApi = api as unknown as {
  listerVersions: ReturnType<typeof vi.fn>;
};

const VERSION_CRECHE: ContratVersionVue = {
  id: 'v2',
  contratId: 'c1',
  mode: 'CRECHE_PSU',
  dateEffet: '2026-09-01',
  du: '2026-09-01',
  au: null,
  heuresAnnuellesContractualisees: 900,
  nbMensualites: 10,
  saisiLe: '2026-08-15T09:00:00.000Z',
  motif: null,
  semaineType: {
    LUNDI: [{ debutHeures: 9, debutMinutes: 0, finHeures: 17, finMinutes: 0 }],
    MARDI: [],
    MERCREDI: [],
    JEUDI: [],
    VENDREDI: [],
    SAMEDI: [],
    DIMANCHE: [],
  },
};

const VERSION_INITIALE: ContratVersionVue = {
  id: 'v1',
  contratId: 'c1',
  mode: 'CRECHE_PSU',
  dateEffet: '2026-01-01',
  du: '2026-01-01',
  au: '2026-08-31',
  heuresAnnuellesContractualisees: 763,
  nbMensualites: 7,
  saisiLe: '2026-01-01T09:00:00.000Z',
  motif: 'correction horaires',
  semaineType: {},
};

describe('HistoriqueContrat', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('liste les versions avec date d’effet, résumé et « en cours »', async () => {
    mockedApi.listerVersions.mockResolvedValue([
      VERSION_CRECHE,
      VERSION_INITIALE,
    ]);
    render(
      <HistoriqueContrat contratId="c1" enfant="Mia" onFermer={vi.fn()} />,
    );

    expect(await screen.findByText(/Historique — Mia/i)).toBeInTheDocument();
    // Deux versions listées, la plus récente est « en cours ».
    expect(
      screen.getByText(/À partir du 1 septembre 2026/i),
    ).toBeInTheDocument();
    expect(screen.getByText(/À partir du 1 janvier 2026/i)).toBeInTheDocument();
    expect(screen.getByText('en cours')).toBeInTheDocument();
    // Résumé crèche : jours + heures + mensualités.
    expect(screen.getByText(/900 h\/an/)).toBeInTheDocument();
    expect(screen.getByText(/10 mensualités/)).toBeInTheDocument();
    // Le motif d'une correction est visible.
    expect(screen.getByText(/correction horaires/)).toBeInTheDocument();
  });

  it('résume une version ABCM par ses jours d’inscription', async () => {
    const versionAbcm: ContratVersionVue = {
      id: 'v3',
      contratId: 'c2',
      mode: 'CANTINE',
      dateEffet: '2026-09-01',
      du: '2026-09-01',
      au: null,
      heuresAnnuellesContractualisees: null,
      nbMensualites: null,
      saisiLe: '2026-08-20T09:00:00.000Z',
      motif: null,
      semaineAbcm: {
        LUNDI: { cantine: true },
        MARDI: {},
        MERCREDI: {},
        JEUDI: { cantine: true },
        VENDREDI: {},
        SAMEDI: {},
        DIMANCHE: {},
      },
    };
    mockedApi.listerVersions.mockResolvedValue([versionAbcm]);
    render(
      <HistoriqueContrat contratId="c2" enfant="Zoé" onFermer={vi.fn()} />,
    );

    expect(await screen.findByText(/Historique — Zoé/i)).toBeInTheDocument();
    // Résumé ABCM : les jours inscrits (Lun. + Jeu.), pas d'heures/mensualités.
    expect(screen.getByText(/Lun\. Jeu\./)).toBeInTheDocument();
    expect(screen.queryByText(/h\/an/)).not.toBeInTheDocument();
  });

  it('ferme au clic sur « Fermer »', async () => {
    const onFermer = vi.fn();
    mockedApi.listerVersions.mockResolvedValue([VERSION_CRECHE]);
    render(
      <HistoriqueContrat contratId="c1" enfant="Mia" onFermer={onFermer} />,
    );
    await screen.findByText(/Historique — Mia/i);
    fireEvent.click(screen.getByRole('button', { name: 'Fermer' }));
    expect(onFermer).toHaveBeenCalled();
  });

  it('affiche un état vide quand aucune version', async () => {
    mockedApi.listerVersions.mockResolvedValue([]);
    render(
      <HistoriqueContrat contratId="c1" enfant="Mia" onFermer={vi.fn()} />,
    );
    expect(
      await screen.findByText(/Aucun changement enregistré/i),
    ).toBeInTheDocument();
  });

  it('affiche une erreur récupérable si le chargement échoue', async () => {
    mockedApi.listerVersions.mockRejectedValue(new Error('boom'));
    render(
      <HistoriqueContrat contratId="c1" enfant="Mia" onFermer={vi.fn()} />,
    );
    await waitFor(() => {
      expect(
        screen.getByText(/Impossible de charger l’historique/i),
      ).toBeInTheDocument();
    });
    expect(
      screen.getByRole('button', { name: /Réessayer/i }),
    ).toBeInTheDocument();
  });
});
