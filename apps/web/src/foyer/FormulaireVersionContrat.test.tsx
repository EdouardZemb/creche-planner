import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { vi, describe, it, expect, beforeEach } from 'vitest';
import { MemoryRouter } from 'react-router-dom';
import { FormulaireVersionContrat } from './FormulaireVersionContrat';
import type { ContratLocal } from '../types/bff';

vi.mock('../api/client', () => ({
  api: {
    creerAvenant: vi.fn(),
    corrigerVersion: vi.fn(),
    apercuImpact: vi.fn(),
  },
  // Réutilisé par le composant pour typer les erreurs (piège documenté).
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

const mockedApi = api as unknown as {
  creerAvenant: ReturnType<typeof vi.fn>;
  corrigerVersion: ReturnType<typeof vi.fn>;
  apercuImpact: ReturnType<typeof vi.fn>;
};

const CONTRAT: ContratLocal = {
  id: 'c1',
  foyerId: 'f1',
  enfant: 'Mia',
  enfantId: 'e1',
  mode: 'CRECHE_PSU',
  valideDu: '2026-01-01',
  valideAu: null,
  heuresAnnuellesContractualisees: 763,
  nbMensualites: 7,
  semaineType: {},
};

function rendre(
  props: Partial<Parameters<typeof FormulaireVersionContrat>[0]>,
) {
  return render(
    <MemoryRouter>
      <FormulaireVersionContrat
        foyerId="f1"
        contrat={CONTRAT}
        variante="avenant"
        onEnregistre={vi.fn()}
        onAnnuler={vi.fn()}
        {...props}
      />
    </MemoryRouter>,
  );
}

describe('FormulaireVersionContrat', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('avenant : champ « À partir du », aucun champ d’identité (H6), lien de simulation', () => {
    rendre({ variante: 'avenant' });
    expect(screen.getByLabelText(/À partir du/i)).toBeInTheDocument();
    // H6 : l'identité (enfant, mode, établissement) est ABSENTE du formulaire.
    expect(screen.queryByLabelText(/Enfant/i)).not.toBeInTheDocument();
    expect(screen.queryByLabelText(/^Mode/i)).not.toBeInTheDocument();
    expect(screen.queryByLabelText(/Établissement/i)).not.toBeInTheDocument();
    // US-30-06 : lien de simulation vers les coûts en mode simulé.
    const lien = screen.getByRole('link', {
      name: /Simuler l’impact sur les coûts/i,
    });
    expect(lien).toHaveAttribute('href', '/foyers/f1/couts?simule=true');
  });

  it('avenant : enregistre via creerAvenant avec date d’effet + paramètres', async () => {
    const onEnregistre = vi.fn();
    mockedApi.creerAvenant.mockResolvedValue({ ...CONTRAT });
    rendre({ variante: 'avenant', onEnregistre });

    fireEvent.change(screen.getByLabelText(/À partir du/i), {
      target: { value: '2026-09-01' },
    });
    fireEvent.click(
      screen.getByRole('button', { name: /Enregistrer le changement/i }),
    );

    await waitFor(() => {
      expect(mockedApi.creerAvenant).toHaveBeenCalledWith(
        'c1',
        expect.objectContaining({
          mode: 'CRECHE_PSU',
          dateEffet: '2026-09-01',
        }),
      );
    });
    expect(onEnregistre).toHaveBeenCalled();
  });

  it('avenant : un 409 devient un message parent (date déjà prise)', async () => {
    mockedApi.creerAvenant.mockRejectedValue(new ApiError(409, {}));
    rendre({ variante: 'avenant' });

    fireEvent.click(
      screen.getByRole('button', { name: /Enregistrer le changement/i }),
    );
    expect(
      await screen.findByText(/Un changement existe déjà à cette date/i),
    ).toBeInTheDocument();
  });

  it('correction : ouvre l’aperçu d’impact puis corrige avec motif', async () => {
    const onEnregistre = vi.fn();
    mockedApi.apercuImpact.mockResolvedValue({
      versionId: 'v1',
      moisCouverts: ['2026-06'],
      moisCommuniques: [],
    });
    mockedApi.corrigerVersion.mockResolvedValue({ ...CONTRAT });
    rendre({ variante: 'correction', versionId: 'v1', onEnregistre });

    // Pas de champ date d'effet en correction.
    expect(screen.queryByLabelText(/À partir du/i)).not.toBeInTheDocument();

    fireEvent.click(
      screen.getByRole('button', { name: /Voir l’impact et corriger/i }),
    );
    await screen.findByText(/1 mois sera recalculé/i);
    fireEvent.change(screen.getByLabelText(/Motif/i), {
      target: { value: 'oubli' },
    });
    fireEvent.click(
      screen.getByRole('button', { name: /Enregistrer la correction/i }),
    );

    await waitFor(() => {
      expect(mockedApi.corrigerVersion).toHaveBeenCalledWith(
        'c1',
        'v1',
        expect.objectContaining({ mode: 'CRECHE_PSU', motif: 'oubli' }),
      );
    });
    expect(onEnregistre).toHaveBeenCalled();
  });
});
