import {
  render,
  screen,
  fireEvent,
  waitFor,
  within,
} from '@testing-library/react';
import { vi, describe, it, expect, beforeEach } from 'vitest';
import { EnfantsSection } from './EnfantsSection';
import type { EnfantVue } from '../types/bff';

vi.mock('../api/client', () => ({
  api: {
    ajouterEnfant: vi.fn(),
    modifierEnfant: vi.fn(),
    retirerEnfant: vi.fn(),
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

const mockedApi = api as unknown as {
  ajouterEnfant: ReturnType<typeof vi.fn>;
  modifierEnfant: ReturnType<typeof vi.fn>;
  retirerEnfant: ReturnType<typeof vi.fn>;
};

const FOYER_ID = 'foyer-123';

const enfant = (e: Partial<EnfantVue> & Pick<EnfantVue, 'id'>): EnfantVue => ({
  foyerId: FOYER_ID,
  prenom: 'Mia',
  dateNaissance: '2024-12-08',
  ...e,
});

describe('EnfantsSection', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('liste les enfants existants comme lignes éditables (prénom pré-rempli)', () => {
    render(
      <EnfantsSection
        foyerId={FOYER_ID}
        enfantsInitiaux={[enfant({ id: 'e1', prenom: 'Mia' })]}
      />,
    );
    // Le prénom est dans un champ éditable (valeur), pas un simple texte.
    expect(screen.getByDisplayValue('Mia')).toBeInTheDocument();
    expect(screen.getByDisplayValue('2024-12-08')).toBeInTheDocument();
  });

  it('énonce que renommer propage aux contrats et que supprimer ne les supprime pas', () => {
    render(<EnfantsSection foyerId={FOYER_ID} enfantsInitiaux={[]} />);
    expect(
      screen.getByText(/Supprimer un enfant ne supprime pas ses contrats/),
    ).toBeInTheDocument();
  });

  it('désactive l’ajout tant que les champs sont vides', () => {
    render(<EnfantsSection foyerId={FOYER_ID} enfantsInitiaux={[]} />);
    expect(
      screen.getByRole('button', { name: '+ Ajouter cet enfant' }),
    ).toBeDisabled();
  });

  it('ajoute un enfant et l’insère dans la liste', async () => {
    mockedApi.ajouterEnfant.mockResolvedValueOnce(
      enfant({ id: 'e2', prenom: 'Zoé', dateNaissance: '2023-03-12' }),
    );
    render(<EnfantsSection foyerId={FOYER_ID} enfantsInitiaux={[]} />);

    const blocAjout = screen
      .getByText('Ajouter un enfant')
      .closest('.enfant-ligne') as HTMLElement;
    fireEvent.change(blocAjout.querySelector('input[type="text"]')!, {
      target: { value: 'Zoé' },
    });
    fireEvent.change(blocAjout.querySelector('input[type="date"]')!, {
      target: { value: '2023-03-12' },
    });
    fireEvent.click(
      screen.getByRole('button', { name: '+ Ajouter cet enfant' }),
    );

    await waitFor(() => {
      expect(mockedApi.ajouterEnfant).toHaveBeenCalledWith(FOYER_ID, {
        prenom: 'Zoé',
        dateNaissance: '2023-03-12',
      });
    });
    expect(await screen.findByDisplayValue('Zoé')).toBeInTheDocument();
  });

  it('édite un enfant existant (prénom)', async () => {
    mockedApi.modifierEnfant.mockResolvedValueOnce(
      enfant({ id: 'e1', prenom: 'Mia-Rose', dateNaissance: '2024-12-08' }),
    );
    render(
      <EnfantsSection
        foyerId={FOYER_ID}
        enfantsInitiaux={[enfant({ id: 'e1', prenom: 'Mia' })]}
      />,
    );

    fireEvent.change(screen.getByDisplayValue('Mia'), {
      target: { value: 'Mia-Rose' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Enregistrer' }));

    await waitFor(() => {
      expect(mockedApi.modifierEnfant).toHaveBeenCalledWith(FOYER_ID, 'e1', {
        prenom: 'Mia-Rose',
        dateNaissance: '2024-12-08',
      });
    });
    expect(screen.getByDisplayValue('Mia-Rose')).toBeInTheDocument();
  });

  it('supprime un enfant APRÈS confirmation dans la modale (variante générique)', async () => {
    mockedApi.retirerEnfant.mockResolvedValueOnce(undefined);
    render(
      <EnfantsSection
        foyerId={FOYER_ID}
        enfantsInitiaux={[enfant({ id: 'e1', prenom: 'Mia' })]}
      />,
    );

    // Le clic ouvre la modale de confirmation ; RIEN n'est encore supprimé.
    fireEvent.click(
      screen.getByRole('button', { name: 'Supprimer l’enfant Mia' }),
    );
    const dialog = screen.getByRole('dialog');
    expect(mockedApi.retirerEnfant).not.toHaveBeenCalled();
    expect(
      within(dialog).getByText(/sera définitivement retiré/),
    ).toBeInTheDocument();

    // Confirmer déclenche la suppression et retire la ligne.
    fireEvent.click(within(dialog).getByRole('button', { name: 'Supprimer' }));
    await waitFor(() => {
      expect(mockedApi.retirerEnfant).toHaveBeenCalledWith(FOYER_ID, 'e1');
    });
    expect(screen.queryByDisplayValue('Mia')).not.toBeInTheDocument();
  });

  it('Annuler dans la modale ne supprime pas l’enfant', () => {
    render(
      <EnfantsSection
        foyerId={FOYER_ID}
        enfantsInitiaux={[enfant({ id: 'e1', prenom: 'Mia' })]}
      />,
    );

    fireEvent.click(
      screen.getByRole('button', { name: 'Supprimer l’enfant Mia' }),
    );
    fireEvent.click(
      within(screen.getByRole('dialog')).getByRole('button', {
        name: 'Annuler',
      }),
    );

    expect(mockedApi.retirerEnfant).not.toHaveBeenCalled();
    expect(screen.getByDisplayValue('Mia')).toBeInTheDocument();
  });

  it('avertit du nombre de contrats liés dans la modale (variante contrats)', () => {
    render(
      <EnfantsSection
        foyerId={FOYER_ID}
        enfantsInitiaux={[enfant({ id: 'e1', prenom: 'Mia' })]}
        contrats={[
          { enfantId: 'e1' } as never,
          { enfantId: 'e1' } as never,
          { enfantId: 'autre' } as never,
        ]}
      />,
    );

    fireEvent.click(
      screen.getByRole('button', { name: 'Supprimer l’enfant Mia' }),
    );
    expect(
      within(screen.getByRole('dialog')).getByText(
        /Mia a 2 contrat\(s\) de garde/,
      ),
    ).toBeInTheDocument();
  });
});
