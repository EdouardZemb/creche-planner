import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { EtablissementsPage } from './EtablissementsPage';
import type { EtablissementFoyerVue } from '../types/bff';

vi.mock('../api/client', () => ({
  api: {
    listerEtablissements: vi.fn(),
    creerEtablissement: vi.fn(),
    modifierEtablissement: vi.fn(),
    supprimerEtablissement: vi.fn(),
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

import { api, ApiError } from '../api/client';

const FOYER = 'f1';

const ETABLISSEMENTS: EtablissementFoyerVue[] = [
  {
    id: 'et-1',
    foyerId: FOYER,
    nom: 'Crèche du Centre',
    emailService: 'creche@example.org',
    preavisRegle: { type: 'JOURS_OUVRES', valeur: 2 },
    types: ['CRECHE_PSU'],
    adresse: '1 rue des Lilas',
    telephone: null,
    contact: null,
    actif: true,
  },
  {
    id: 'et-2',
    foyerId: FOYER,
    nom: 'École Jean Jaurès',
    emailService: 'ecole@example.org',
    preavisRegle: { type: 'JOUR_HEURE', jour: 'JEUDI', heure: '12:00' },
    types: ['CANTINE', 'PERISCOLAIRE'],
    adresse: null,
    telephone: null,
    contact: null,
    actif: true,
  },
];

function rendre() {
  return render(
    <MemoryRouter initialEntries={[`/foyers/${FOYER}/etablissements`]}>
      <Routes>
        <Route
          path="/foyers/:foyerId/etablissements"
          element={<EtablissementsPage />}
        />
      </Routes>
    </MemoryRouter>,
  );
}

describe('EtablissementsPage (per-foyer)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('liste les crèches / écoles du foyer avec leur délai pour prévenir', async () => {
    vi.mocked(api.listerEtablissements).mockResolvedValue(ETABLISSEMENTS);
    rendre();

    expect(await screen.findByText('Crèche du Centre')).toBeInTheDocument();
    expect(screen.getByText('École Jean Jaurès')).toBeInTheDocument();
    expect(api.listerEtablissements).toHaveBeenCalledWith(FOYER, {
      signal: expect.anything(),
    });
    // Le délai est reformulé en langage parent (plus de « préavis » visible).
    expect(
      screen.getByText(/Délai pour prévenir : 2 jours ouvrés/),
    ).toBeInTheDocument();
    expect(screen.getByText(/avant jeudi 12 h/)).toBeInTheDocument();
    // Le bloc « Types proposés » a été retiré de l'écran.
    expect(screen.queryByText(/Types :/)).not.toBeInTheDocument();
  });

  it('avertit qu’une crèche active sans e-mail ne recevra pas les récaps', async () => {
    vi.mocked(api.listerEtablissements).mockResolvedValue([
      { ...ETABLISSEMENTS[0]!, emailService: null },
    ]);
    rendre();

    await screen.findByText('Crèche du Centre');
    const avertissement = screen.getByRole('note');
    expect(avertissement).toHaveTextContent(
      /Sans e-mail, ce lieu d’accueil ne recevra pas les récapitulatifs/i,
    );
  });

  it('n’affiche pas l’avertissement « sans e-mail » pour une crèche archivée', async () => {
    vi.mocked(api.listerEtablissements).mockResolvedValue([
      { ...ETABLISSEMENTS[0]!, emailService: null, actif: false },
    ]);
    rendre();

    await screen.findByText('Crèche du Centre');
    expect(screen.queryByRole('note')).not.toBeInTheDocument();
  });

  it('crée une nouvelle crèche / école (sans envoyer `types`)', async () => {
    vi.mocked(api.listerEtablissements).mockResolvedValue([]);
    vi.mocked(api.creerEtablissement).mockResolvedValue({
      ...ETABLISSEMENTS[0]!,
      nom: 'Nouvelle crèche',
    });
    rendre();

    // État vide : l'accueil oriente vers l'ajout d'une première crèche.
    await screen.findByText('Ajoutez votre première crèche ou école');
    fireEvent.click(
      screen.getByRole('button', { name: /Ajouter une crèche . école/i }),
    );

    fireEvent.change(screen.getByRole('textbox', { name: 'Nom' }), {
      target: { value: 'Nouvelle crèche' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Ajouter' }));

    await waitFor(() => {
      expect(api.creerEtablissement).toHaveBeenCalledTimes(1);
    });
    const [foyerArg, corps] = vi.mocked(api.creerEtablissement).mock.calls[0]!;
    expect(foyerArg).toBe(FOYER);
    expect(corps.nom).toBe('Nouvelle crèche');
    expect(corps.preavisRegle).toBeNull();
    // `types` n'est plus renseigné à l'écran → absent du payload.
    expect(corps).not.toHaveProperty('types');
    expect(
      await screen.findByText(/« Nouvelle crèche » ajoutée/),
    ).toBeInTheDocument();
  });

  it('affiche un message explicite si la suppression est bloquée (409)', async () => {
    vi.mocked(api.listerEtablissements).mockResolvedValue(ETABLISSEMENTS);
    vi.mocked(api.supprimerEtablissement).mockRejectedValue(
      new ApiError(409, undefined),
    );
    rendre();

    await screen.findByText('Crèche du Centre');
    fireEvent.click(
      screen.getByRole('button', { name: /Supprimer Crèche du Centre/i }),
    );
    // Confirme dans la modale.
    fireEvent.click(
      screen.getByRole('button', { name: /Supprimer la crèche . école/i }),
    );

    expect(
      await screen.findByText(/des contrats y sont rattachés/i),
    ).toBeInTheDocument();
  });

  it('affiche l’état vide quand le foyer n’a aucune crèche / école', async () => {
    vi.mocked(api.listerEtablissements).mockResolvedValue([]);
    rendre();

    expect(
      await screen.findByText('Ajoutez votre première crèche ou école'),
    ).toBeInTheDocument();
  });

  it('affiche l’erreur de chargement et recharge via « Réessayer »', async () => {
    vi.mocked(api.listerEtablissements)
      .mockRejectedValueOnce(new ApiError(502, undefined))
      .mockResolvedValueOnce(ETABLISSEMENTS);
    rendre();

    const alerte = await screen.findByRole('alert');
    expect(alerte).toHaveTextContent(
      'Service indisponible, réessayez dans un instant.',
    );

    fireEvent.click(screen.getByRole('button', { name: 'Réessayer' }));

    expect(await screen.findByText('Crèche du Centre')).toBeInTheDocument();
    expect(api.listerEtablissements).toHaveBeenCalledTimes(2);
  });

  it('affiche les erreurs de validation par champ à la création (422)', async () => {
    vi.mocked(api.listerEtablissements).mockResolvedValue([]);
    vi.mocked(api.creerEtablissement).mockRejectedValue(
      new ApiError(422, [
        { champ: 'nom', message: 'Ce nom est déjà utilisé.' },
        { champ: 'emailService', message: 'Adresse e-mail invalide.' },
      ]),
    );
    rendre();

    await screen.findByText('Ajoutez votre première crèche ou école');
    fireEvent.click(
      screen.getByRole('button', { name: /Ajouter une crèche . école/i }),
    );
    fireEvent.change(screen.getByRole('textbox', { name: 'Nom' }), {
      target: { value: 'Crèche du Centre' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Ajouter' }));

    expect(
      await screen.findByText('Ce nom est déjà utilisé.'),
    ).toBeInTheDocument();
    expect(screen.getByText('Adresse e-mail invalide.')).toBeInTheDocument();
    // Les champs fautifs sont marqués pour les technologies d'assistance.
    expect(screen.getByRole('textbox', { name: 'Nom' })).toHaveAttribute(
      'aria-invalid',
      'true',
    );
    expect(screen.getByLabelText(/E-mail de la crèche/i)).toHaveAttribute(
      'aria-invalid',
      'true',
    );
    // Le formulaire reste ouvert pour corriger.
    expect(screen.getByRole('button', { name: 'Ajouter' })).toBeEnabled();
  });

  it('affiche un message global quand le serveur rejette la création (500)', async () => {
    vi.mocked(api.listerEtablissements).mockResolvedValue([]);
    vi.mocked(api.creerEtablissement).mockRejectedValue(
      new ApiError(500, undefined),
    );
    rendre();

    await screen.findByText('Ajoutez votre première crèche ou école');
    fireEvent.click(
      screen.getByRole('button', { name: /Ajouter une crèche . école/i }),
    );
    fireEvent.change(screen.getByRole('textbox', { name: 'Nom' }), {
      target: { value: 'Crèche du Centre' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Ajouter' }));

    expect(
      await screen.findByText(
        'Service indisponible, réessayez dans un instant.',
      ),
    ).toBeInTheDocument();
  });

  it('modifie une crèche / école depuis le formulaire prérempli', async () => {
    vi.mocked(api.listerEtablissements).mockResolvedValue(ETABLISSEMENTS);
    vi.mocked(api.modifierEtablissement).mockResolvedValue({
      ...ETABLISSEMENTS[0]!,
      nom: 'Crèche rebaptisée',
    });
    rendre();

    await screen.findByText('Crèche du Centre');
    fireEvent.click(
      screen.getByRole('button', { name: /Modifier Crèche du Centre/i }),
    );

    // Formulaire prérempli depuis la crèche existante.
    expect(
      screen.getByRole('heading', { name: 'Modifier' }),
    ).toBeInTheDocument();
    expect(screen.getByRole('textbox', { name: 'Nom' })).toHaveValue(
      'Crèche du Centre',
    );
    expect(screen.getByLabelText('Un nombre de jours ouvrés')).toBeChecked();

    fireEvent.change(screen.getByRole('textbox', { name: 'Nom' }), {
      target: { value: 'Crèche rebaptisée' },
    });
    fireEvent.click(
      screen.getByRole('button', { name: /Enregistrer les modifications/i }),
    );

    await waitFor(() => {
      expect(api.modifierEtablissement).toHaveBeenCalledTimes(1);
    });
    const [foyerArg, idArg, corps] = vi.mocked(api.modifierEtablissement).mock
      .calls[0]!;
    expect(foyerArg).toBe(FOYER);
    expect(idArg).toBe('et-1');
    expect(corps).toMatchObject({
      nom: 'Crèche rebaptisée',
      emailService: 'creche@example.org',
      preavisRegle: { type: 'JOURS_OUVRES', valeur: 2 },
      adresse: '1 rue des Lilas',
    });
    // `types` n'est plus renseigné à l'écran → absent du payload d'édition.
    expect(corps).not.toHaveProperty('types');
    expect(
      await screen.findByText(/« Crèche rebaptisée » modifiée/),
    ).toBeInTheDocument();
  });

  it('supprime une crèche / école après confirmation dans la modale', async () => {
    vi.mocked(api.listerEtablissements).mockResolvedValue(ETABLISSEMENTS);
    vi.mocked(api.supprimerEtablissement).mockResolvedValue(undefined);
    rendre();

    await screen.findByText('Crèche du Centre');
    fireEvent.click(
      screen.getByRole('button', { name: /Supprimer Crèche du Centre/i }),
    );

    // La modale de confirmation explique la conséquence avant d'agir.
    expect(
      screen.getByText(/sera définitivement supprimée/i),
    ).toBeInTheDocument();
    fireEvent.click(
      screen.getByRole('button', { name: /Supprimer la crèche . école/i }),
    );

    await waitFor(() => {
      expect(api.supprimerEtablissement).toHaveBeenCalledWith(FOYER, 'et-1');
    });
    expect(
      await screen.findByText(/« Crèche du Centre » supprimée/),
    ).toBeInTheDocument();
    // La liste est rechargée après suppression.
    expect(api.listerEtablissements).toHaveBeenCalledTimes(2);
  });

  it('annule la suppression depuis la modale sans appeler l’API', async () => {
    vi.mocked(api.listerEtablissements).mockResolvedValue(ETABLISSEMENTS);
    rendre();

    await screen.findByText('Crèche du Centre');
    fireEvent.click(
      screen.getByRole('button', { name: /Supprimer Crèche du Centre/i }),
    );
    fireEvent.click(screen.getByRole('button', { name: 'Annuler' }));

    expect(api.supprimerEtablissement).not.toHaveBeenCalled();
    expect(
      screen.queryByText(/sera définitivement supprimée/i),
    ).not.toBeInTheDocument();
  });

  it('affiche une erreur lisible quand l’archivage échoue', async () => {
    vi.mocked(api.listerEtablissements).mockResolvedValue(ETABLISSEMENTS);
    vi.mocked(api.modifierEtablissement).mockRejectedValue(
      new ApiError(502, undefined),
    );
    rendre();

    await screen.findByText('Crèche du Centre');
    fireEvent.click(
      screen.getByRole('button', { name: /Archiver Crèche du Centre/i }),
    );

    expect(
      await screen.findByText(
        'Service indisponible, réessayez dans un instant.',
      ),
    ).toBeInTheDocument();
  });

  it('archive une crèche / école (PUT actif: false)', async () => {
    vi.mocked(api.listerEtablissements).mockResolvedValue(ETABLISSEMENTS);
    vi.mocked(api.modifierEtablissement).mockResolvedValue({
      ...ETABLISSEMENTS[0]!,
      actif: false,
    });
    rendre();

    await screen.findByText('Crèche du Centre');
    fireEvent.click(
      screen.getByRole('button', { name: /Archiver Crèche du Centre/i }),
    );

    await waitFor(() => {
      expect(api.modifierEtablissement).toHaveBeenCalledWith(FOYER, 'et-1', {
        actif: false,
      });
    });
    expect(await screen.findByText(/archivée/)).toBeInTheDocument();
  });
});
