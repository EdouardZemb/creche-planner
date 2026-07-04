import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { vi, describe, it, expect, beforeEach } from 'vitest';
import { ContratForm } from './ContratForm';
import type {
  EnfantVue,
  ContratVue,
  ContratLocal,
  EtablissementFoyerVue,
} from '../types/bff';

vi.mock('../api/client', () => ({
  api: {
    creerContrat: vi.fn(),
    modifierContrat: vi.fn(),
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

const mockedApi = api as unknown as {
  creerContrat: ReturnType<typeof vi.fn>;
  modifierContrat: ReturnType<typeof vi.fn>;
};

const enfantsTest: EnfantVue[] = [
  { id: 'e1', foyerId: 'f1', prenom: 'Mia', dateNaissance: '2024-12-08' },
  { id: 'e2', foyerId: 'f1', prenom: 'Zoé', dateNaissance: '2023-03-12' },
];

const contratVueFactice: ContratVue = {
  id: 'c1',
  foyerId: 'f1',
  enfant: 'Mia',
  mode: 'CRECHE_PSU',
  valideDu: '2026-09-01',
  valideAu: null,
};

const etablissementsTest: EtablissementFoyerVue[] = [
  {
    id: 'et-1',
    foyerId: 'f1',
    nom: 'Crèche du Centre',
    emailService: 'creche@example.org',
    preavisRegle: { type: 'JOURS_OUVRES', valeur: 2 },
    types: ['CRECHE_PSU'],
    adresse: null,
    telephone: null,
    contact: null,
    actif: true,
  },
];

function rendu(onCree = vi.fn()) {
  return render(
    <ContratForm
      foyerId="f1"
      enfants={enfantsTest}
      etablissements={etablissementsTest}
      onCree={onCree}
    />,
  );
}

/** Sélectionne l'établissement de test (obligatoire depuis P5) avant de soumettre. */
function choisirEtablissement(): void {
  fireEvent.change(screen.getByLabelText(/Établissement/i), {
    target: { value: 'et-1' },
  });
}

describe('ContratForm', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('affiche les champs de base', () => {
    rendu();

    expect(screen.getByLabelText(/Mode/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/Enfant/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/Valide du/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/Valide au/i)).toBeInTheDocument();
  });

  it('affiche les champs CRECHE_PSU par défaut', () => {
    rendu();

    expect(screen.getByLabelText(/Heures annuelles/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/mensualités/i)).toBeInTheDocument();
    expect(screen.getByText(/Semaine type/i)).toBeInTheDocument();

    // Les jours de la semaine doivent apparaître
    expect(screen.getByText('Lundi')).toBeInTheDocument();
    expect(screen.getByText('Vendredi')).toBeInTheDocument();
  });

  it('bascule vers les champs CANTINE', () => {
    rendu();

    const selectMode = screen.getByLabelText(/Mode/i);
    fireEvent.change(selectMode, { target: { value: 'CANTINE' } });

    // Les champs CRECHE_PSU doivent disparaître
    expect(
      screen.queryByLabelText(/Heures annuelles/i),
    ).not.toBeInTheDocument();
    expect(screen.queryByLabelText(/mensualités/i)).not.toBeInTheDocument();

    // Le tableau ABCM doit apparaître
    expect(screen.getByText(/Inscriptions hebdomadaires/i)).toBeInTheDocument();
    expect(screen.getByText('Lundi')).toBeInTheDocument();
  });

  it('bascule vers les champs PERISCOLAIRE', () => {
    rendu();

    fireEvent.change(screen.getByLabelText(/Mode/i), {
      target: { value: 'PERISCOLAIRE' },
    });

    expect(screen.getByText(/Inscriptions hebdomadaires/i)).toBeInTheDocument();
  });

  it('bascule vers les champs ALSH', () => {
    rendu();

    fireEvent.change(screen.getByLabelText(/Mode/i), {
      target: { value: 'ALSH' },
    });

    expect(screen.getByText(/Inscriptions hebdomadaires/i)).toBeInTheDocument();
  });

  // UT-10 : cocher un jour ALSH écrit la configuration récurrente (pas cantine).
  it('coche un jour ALSH → écrit la récurrence alsh (pas cantine)', async () => {
    mockedApi.creerContrat.mockResolvedValueOnce({
      ...contratVueFactice,
      mode: 'ALSH',
    });
    const onCree = vi.fn();
    rendu(onCree);

    fireEvent.change(screen.getByLabelText(/Mode/i), {
      target: { value: 'ALSH' },
    });
    fireEvent.change(screen.getByLabelText(/Valide du/i), {
      target: { value: '2026-09-01' },
    });
    fireEvent.click(screen.getByRole('checkbox', { name: /ALSH Lundi/i }));
    choisirEtablissement();
    fireEvent.click(screen.getByRole('button', { name: /Créer le contrat/i }));

    await waitFor(() => {
      expect(mockedApi.creerContrat).toHaveBeenCalledTimes(1);
    });

    const saisie = (mockedApi.creerContrat.mock.calls[0] as unknown[])[0] as {
      semaineAbcm: Record<
        string,
        { cantine?: boolean; alsh?: { type: string; repas?: boolean } }
      >;
    };
    // Défaut à la coche : journée complète, sans repas (le parent opte pour le repas).
    expect(saisie.semaineAbcm['LUNDI']?.alsh).toEqual({ type: 'COMPLETE' });
    // Non-régression : la cantine n'est pas corrompue par la saisie ALSH.
    expect(saisie.semaineAbcm['LUNDI']?.cantine).toBeUndefined();
  });

  it('formule demi-journée + repas → écrit la configuration ALSH complète', async () => {
    mockedApi.creerContrat.mockResolvedValueOnce({
      ...contratVueFactice,
      mode: 'ALSH',
    });
    rendu();

    fireEvent.change(screen.getByLabelText(/Mode/i), {
      target: { value: 'ALSH' },
    });
    fireEvent.change(screen.getByLabelText(/Valide du/i), {
      target: { value: '2026-09-01' },
    });
    fireEvent.click(screen.getByRole('checkbox', { name: /ALSH Mercredi/i }));
    fireEvent.change(screen.getByLabelText(/Formule Mercredi/i), {
      target: { value: 'DEMI' },
    });
    fireEvent.click(screen.getByRole('checkbox', { name: /Repas Mercredi/i }));
    choisirEtablissement();
    fireEvent.click(screen.getByRole('button', { name: /Créer le contrat/i }));

    await waitFor(() => {
      expect(mockedApi.creerContrat).toHaveBeenCalledTimes(1);
    });

    const saisie = (mockedApi.creerContrat.mock.calls[0] as unknown[])[0] as {
      semaineAbcm: Record<string, { alsh?: { type: string; repas?: boolean } }>;
    };
    expect(saisie.semaineAbcm['MERCREDI']?.alsh).toEqual({
      type: 'DEMI',
      repas: true,
    });
  });

  // UT-10 : non-régression de la saisie cantine (mode CANTINE).
  it('coche la colonne Cantine → écrit dans le champ cantine', async () => {
    mockedApi.creerContrat.mockResolvedValueOnce({
      ...contratVueFactice,
      mode: 'CANTINE',
    });
    const onCree = vi.fn();
    rendu(onCree);

    fireEvent.change(screen.getByLabelText(/Mode/i), {
      target: { value: 'CANTINE' },
    });
    fireEvent.change(screen.getByLabelText(/Valide du/i), {
      target: { value: '2026-09-01' },
    });
    fireEvent.click(screen.getByRole('checkbox', { name: /Cantine Lundi/i }));
    choisirEtablissement();
    fireEvent.click(screen.getByRole('button', { name: /Créer le contrat/i }));

    await waitFor(() => {
      expect(mockedApi.creerContrat).toHaveBeenCalledTimes(1);
    });

    const saisie = (mockedApi.creerContrat.mock.calls[0] as unknown[])[0] as {
      semaineAbcm: Record<string, { cantine?: boolean; alsh?: boolean }>;
    };
    expect(saisie.semaineAbcm['LUNDI']?.cantine).toBe(true);
    expect(saisie.semaineAbcm['LUNDI']?.alsh).toBeUndefined();
  });

  // UT-08 : sigle ALSH explicité via <abbr> dans l'en-tête de colonne.
  it('explicite le sigle ALSH via un <abbr> dans la colonne', () => {
    rendu();
    fireEvent.change(screen.getByLabelText(/Mode/i), {
      target: { value: 'ALSH' },
    });

    const abbr = screen.getByTitle('Accueil de loisirs sans hébergement');
    expect(abbr.tagName).toBe('ABBR');
    expect(abbr).toHaveTextContent('ALSH');
  });

  it('soumet un contrat CRECHE_PSU et appelle onCree', async () => {
    mockedApi.creerContrat.mockResolvedValueOnce(contratVueFactice);
    const onCree = vi.fn();
    rendu(onCree);

    // Remplir la date
    fireEvent.change(screen.getByLabelText(/Valide du/i), {
      target: { value: '2026-09-01' },
    });
    choisirEtablissement();

    fireEvent.click(screen.getByRole('button', { name: /Créer le contrat/i }));

    await waitFor(() => {
      expect(mockedApi.creerContrat).toHaveBeenCalledTimes(1);
    });

    const appel = mockedApi.creerContrat.mock.calls[0] as unknown[];
    const saisie = appel[0] as Record<string, unknown>;
    expect(saisie['mode']).toBe('CRECHE_PSU');
    expect(saisie['foyerId']).toBe('f1');
    expect(saisie['enfant']).toBe('Mia');
    expect(saisie['valideAu']).toBeNull();

    expect(onCree).toHaveBeenCalledTimes(1);
    const contratLocal = onCree.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(contratLocal['heuresAnnuellesContractualisees']).toBeDefined();
    expect(contratLocal['semaineType']).toBeDefined();
  });

  it("affiche une erreur en cas d'ApiError", async () => {
    mockedApi.creerContrat.mockRejectedValueOnce(
      new ApiError(400, [{ champ: 'valideDu', message: 'Date invalide' }]),
    );
    rendu();

    fireEvent.change(screen.getByLabelText(/Valide du/i), {
      target: { value: '2026-09-01' },
    });
    choisirEtablissement();
    fireEvent.click(screen.getByRole('button', { name: /Créer le contrat/i }));

    await waitFor(() => {
      expect(screen.getByText('Date invalide')).toBeInTheDocument();
    });
  });

  it('lie le champ en erreur via aria-invalid + aria-describedby (EX-11)', async () => {
    mockedApi.creerContrat.mockRejectedValueOnce(
      new ApiError(400, [{ champ: 'valideDu', message: 'Date invalide' }]),
    );
    rendu();

    const champ = screen.getByLabelText(/Valide du/i);
    fireEvent.change(champ, { target: { value: '2026-09-01' } });
    choisirEtablissement();
    fireEvent.click(screen.getByRole('button', { name: /Créer le contrat/i }));

    await waitFor(() => {
      expect(champ).toHaveAttribute('aria-invalid', 'true');
    });
    const idDecrit = champ.getAttribute('aria-describedby');
    expect(idDecrit).toBeTruthy();
    const message = document.getElementById(idDecrit!);
    expect(message).not.toBeNull();
    expect(message).toHaveTextContent('Date invalide');
  });

  it('expose scope sur les en-têtes du tableau ABCM (EX-16)', () => {
    rendu();
    fireEvent.change(screen.getByLabelText(/Mode/i), {
      target: { value: 'CANTINE' },
    });

    const enteteJour = screen.getByRole('columnheader', { name: 'Jour' });
    expect(enteteJour).toHaveAttribute('scope', 'col');

    const enteteLundi = screen.getByRole('rowheader', { name: 'Lundi' });
    expect(enteteLundi).toHaveAttribute('scope', 'row');
  });

  it('affiche les enfants dans le sélecteur', () => {
    rendu();

    expect(screen.getByText('Mia')).toBeInTheDocument();
    expect(screen.getByText('Zoé')).toBeInTheDocument();
  });

  // ---- Mode édition --------------------------------------------------------

  const contratEditeFactice: ContratLocal = {
    id: 'c1',
    foyerId: 'f1',
    enfant: 'Zoé',
    mode: 'CRECHE_PSU',
    etablissementId: 'et-1',
    valideDu: '2026-01-01',
    valideAu: '2026-12-31',
    heuresAnnuellesContractualisees: 763,
    nbMensualites: 7,
    semaineType: {
      LUNDI: [
        { debutHeures: 8, debutMinutes: 30, finHeures: 17, finMinutes: 0 },
      ],
    },
  };

  it('pré-remplit les champs en mode édition', () => {
    render(
      <ContratForm
        foyerId="f1"
        enfants={enfantsTest}
        etablissements={etablissementsTest}
        contrat={contratEditeFactice}
        onCree={vi.fn()}
      />,
    );

    expect(
      (screen.getByLabelText(/Valide du/i) as HTMLInputElement).value,
    ).toBe('2026-01-01');
    expect(
      (screen.getByLabelText(/Heures annuelles/i) as HTMLInputElement).value,
    ).toBe('763');
    expect(
      screen.getByRole('button', { name: /Enregistrer les modifications/i }),
    ).toBeInTheDocument();
  });

  it('appelle modifierContrat (pas creerContrat) à la soumission en édition', async () => {
    mockedApi.modifierContrat.mockResolvedValueOnce({
      ...contratVueFactice,
      enfant: 'Zoé',
      valideAu: '2026-12-31',
    });
    const onCree = vi.fn();
    render(
      <ContratForm
        foyerId="f1"
        enfants={enfantsTest}
        etablissements={etablissementsTest}
        contrat={contratEditeFactice}
        onCree={onCree}
      />,
    );

    fireEvent.click(
      screen.getByRole('button', { name: /Enregistrer les modifications/i }),
    );

    await waitFor(() => {
      expect(mockedApi.modifierContrat).toHaveBeenCalledTimes(1);
    });
    expect(mockedApi.creerContrat).not.toHaveBeenCalled();

    const appel = mockedApi.modifierContrat.mock.calls[0] as unknown[];
    expect(appel[0]).toBe('c1');
    const saisie = appel[1] as Record<string, unknown>;
    expect(saisie['enfant']).toBe('Zoé');
    expect(saisie['valideAu']).toBe('2026-12-31');

    expect(onCree).toHaveBeenCalledTimes(1);
    const contratLocal = onCree.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(contratLocal['semaineType']).toBeDefined();
  });

  // ---- Établissement (P4) --------------------------------------------------

  it('rattache un établissement existant (etablissementId)', async () => {
    mockedApi.creerContrat.mockResolvedValueOnce(contratVueFactice);
    render(
      <ContratForm
        foyerId="f1"
        enfants={enfantsTest}
        etablissements={etablissementsTest}
        onCree={vi.fn()}
      />,
    );

    fireEvent.change(screen.getByLabelText(/Valide du/i), {
      target: { value: '2026-09-01' },
    });
    fireEvent.change(screen.getByLabelText(/Établissement/i), {
      target: { value: 'et-1' },
    });
    fireEvent.click(screen.getByRole('button', { name: /Créer le contrat/i }));

    await waitFor(() => {
      expect(mockedApi.creerContrat).toHaveBeenCalledTimes(1);
    });
    const saisie = (
      mockedApi.creerContrat.mock.calls[0] as unknown[]
    )[0] as Record<string, unknown>;
    expect(saisie['etablissementId']).toBe('et-1');
    expect(saisie['nouvelEtablissement']).toBeUndefined();
  });

  it('crée un établissement à la volée (nouvelEtablissement)', async () => {
    mockedApi.creerContrat.mockResolvedValueOnce(contratVueFactice);
    render(
      <ContratForm
        foyerId="f1"
        enfants={enfantsTest}
        etablissements={etablissementsTest}
        onCree={vi.fn()}
      />,
    );

    fireEvent.change(screen.getByLabelText(/Valide du/i), {
      target: { value: '2026-09-01' },
    });
    fireEvent.change(screen.getByLabelText(/Établissement/i), {
      target: { value: '__nouveau__' },
    });
    fireEvent.change(screen.getByLabelText(/Nom du nouvel établissement/i), {
      target: { value: 'Micro-crèche Pomme' },
    });
    fireEvent.click(screen.getByRole('button', { name: /Créer le contrat/i }));

    await waitFor(() => {
      expect(mockedApi.creerContrat).toHaveBeenCalledTimes(1);
    });
    const saisie = (mockedApi.creerContrat.mock.calls[0] as unknown[])[0] as {
      etablissementId?: string;
      nouvelEtablissement?: { nom: string };
    };
    expect(saisie.etablissementId).toBeUndefined();
    expect(saisie.nouvelEtablissement?.nom).toBe('Micro-crèche Pomme');
  });

  it('refuse de soumettre sans établissement (lien obligatoire P5)', async () => {
    render(
      <ContratForm
        foyerId="f1"
        enfants={enfantsTest}
        etablissements={etablissementsTest}
        onCree={vi.fn()}
      />,
    );

    fireEvent.change(screen.getByLabelText(/Valide du/i), {
      target: { value: '2026-09-01' },
    });
    // Aucun établissement sélectionné (placeholder) → soumission bloquée côté front.
    fireEvent.click(screen.getByRole('button', { name: /Créer le contrat/i }));

    await waitFor(() => {
      expect(
        screen.getByText(/sélectionner ou créer un établissement/i),
      ).toBeInTheDocument();
    });
    expect(mockedApi.creerContrat).not.toHaveBeenCalled();
  });

  it('pré-sélectionne l’établissement du contrat en édition', () => {
    render(
      <ContratForm
        foyerId="f1"
        enfants={enfantsTest}
        etablissements={etablissementsTest}
        contrat={{ ...contratEditeFactice, etablissementId: 'et-1' }}
        onCree={vi.fn()}
      />,
    );

    expect(
      (screen.getByLabelText(/Établissement/i) as HTMLSelectElement).value,
    ).toBe('et-1');
  });
});
