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
import { problemeValidation } from '../utils/probleme.fixture';

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
  enfantId: 'e1',
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

/** Établissement **archivé** (Lot 3) : plus proposable pour un nouveau rattachement. */
const etablissementArchive: EtablissementFoyerVue = {
  id: 'et-arch',
  foyerId: 'f1',
  nom: 'Crèche Fermée',
  emailService: null,
  preavisRegle: null,
  types: [],
  adresse: null,
  telephone: null,
  contact: null,
  actif: false,
};

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

  it('rejette côté client une date de fin antérieure au début', async () => {
    rendu();

    fireEvent.change(screen.getByLabelText(/Valide du/i), {
      target: { value: '2026-09-01' },
    });
    fireEvent.change(screen.getByLabelText(/Valide au/i), {
      target: { value: '2026-08-01' },
    });
    choisirEtablissement();
    fireEvent.click(screen.getByRole('button', { name: /Créer le contrat/i }));

    expect(
      await screen.findByText(
        /La date de fin doit être après la date de début/i,
      ),
    ).toBeInTheDocument();
    expect(mockedApi.creerContrat).not.toHaveBeenCalled();
  });

  it('Annuler sans saisie ferme directement le formulaire', () => {
    const onAnnuler = vi.fn();
    render(
      <ContratForm
        foyerId="f1"
        enfants={enfantsTest}
        etablissements={etablissementsTest}
        onCree={vi.fn()}
        onAnnuler={onAnnuler}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Annuler' }));
    expect(onAnnuler).toHaveBeenCalledTimes(1);
  });

  it('Annuler après saisie demande confirmation avant d’abandonner', () => {
    const onAnnuler = vi.fn();
    render(
      <ContratForm
        foyerId="f1"
        enfants={enfantsTest}
        etablissements={etablissementsTest}
        onCree={vi.fn()}
        onAnnuler={onAnnuler}
      />,
    );

    fireEvent.change(screen.getByLabelText(/Valide du/i), {
      target: { value: '2026-09-01' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Annuler' }));

    // Pas de fermeture directe : la confirmation s'interpose.
    expect(onAnnuler).not.toHaveBeenCalled();
    expect(screen.getByText('Abandonner la saisie')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Abandonner' }));
    expect(onAnnuler).toHaveBeenCalledTimes(1);
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

  // ---- Première inscription à l'association (lot 4a) ------------------------

  it('coche « Première inscription » (cantine) → payload premiereInscription: true', async () => {
    mockedApi.creerContrat.mockResolvedValueOnce({
      ...contratVueFactice,
      mode: 'CANTINE',
      premiereInscription: true,
    });
    rendu();

    fireEvent.change(screen.getByLabelText(/Mode/i), {
      target: { value: 'CANTINE' },
    });
    fireEvent.change(screen.getByLabelText(/Valide du/i), {
      target: { value: '2026-09-01' },
    });
    fireEvent.click(
      screen.getByRole('checkbox', {
        name: /Première inscription de l’enfant à l’association/i,
      }),
    );
    choisirEtablissement();
    fireEvent.click(screen.getByRole('button', { name: /Créer le contrat/i }));

    await waitFor(() => {
      expect(mockedApi.creerContrat).toHaveBeenCalledTimes(1);
    });
    const saisie = (mockedApi.creerContrat.mock.calls[0] as unknown[])[0] as {
      premiereInscription?: boolean;
    };
    expect(saisie.premiereInscription).toBe(true);
  });

  it('case décochée (défaut) → payload premiereInscription: false', async () => {
    mockedApi.creerContrat.mockResolvedValueOnce({
      ...contratVueFactice,
      mode: 'CANTINE',
    });
    rendu();

    fireEvent.change(screen.getByLabelText(/Mode/i), {
      target: { value: 'CANTINE' },
    });
    fireEvent.change(screen.getByLabelText(/Valide du/i), {
      target: { value: '2026-09-01' },
    });
    choisirEtablissement();
    fireEvent.click(screen.getByRole('button', { name: /Créer le contrat/i }));

    await waitFor(() => {
      expect(mockedApi.creerContrat).toHaveBeenCalledTimes(1);
    });
    const saisie = (mockedApi.creerContrat.mock.calls[0] as unknown[])[0] as {
      premiereInscription?: boolean;
    };
    expect(saisie.premiereInscription).toBe(false);
  });

  it('la case « Première inscription » est absente en mode crèche (CRECHE_PSU)', () => {
    rendu();

    // Mode par défaut : CRECHE_PSU — la case ne doit pas exister.
    expect(
      screen.queryByRole('checkbox', {
        name: /Première inscription de l’enfant à l’association/i,
      }),
    ).not.toBeInTheDocument();

    // Elle apparaît pour chaque mode ABCM.
    for (const mode of ['CANTINE', 'PERISCOLAIRE', 'ALSH']) {
      fireEvent.change(screen.getByLabelText(/Mode/i), {
        target: { value: mode },
      });
      expect(
        screen.getByRole('checkbox', {
          name: /Première inscription de l’enfant à l’association/i,
        }),
      ).toBeInTheDocument();
    }
  });

  it('pré-coche « Première inscription » à l’édition d’un contrat qui la porte', () => {
    render(
      <ContratForm
        foyerId="f1"
        enfants={enfantsTest}
        etablissements={etablissementsTest}
        contrat={{
          id: 'c2',
          foyerId: 'f1',
          enfant: 'Zoé',
          enfantId: 'e2',
          mode: 'CANTINE',
          etablissementId: 'et-1',
          valideDu: '2026-09-01',
          valideAu: null,
          premiereInscription: true,
          semaineAbcm: { LUNDI: { cantine: true } },
        }}
        onCree={vi.fn()}
      />,
    );

    expect(
      screen.getByRole('checkbox', {
        name: /Première inscription de l’enfant à l’association/i,
      }),
    ).toBeChecked();
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
      new ApiError(
        400,
        problemeValidation([{ champ: 'valideDu', message: 'Date invalide' }]),
      ),
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
      new ApiError(
        400,
        problemeValidation([{ champ: 'valideDu', message: 'Date invalide' }]),
      ),
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
    enfantId: 'e2',
    mode: 'CRECHE_PSU',
    etablissementId: 'et-1',
    valideDu: '2026-01-01',
    valideAu: '2026-12-31',
    heuresAnnuellesContractualisees: 763,
    nbMensualites: 7,
    // Trois jours gardés (8 h 30 → 17 h 00 = 25 h 30/semaine). La fixture n'en
    // portait qu'un : 763 h annuelles auraient alors exigé 90 lundis dans
    // l'année, ce qui est impossible — et c'est exactement ce que la garde de
    // cohérence refuse désormais. Le plafond de cette semaine sur 2026 est de
    // 1326 h, la fixture est donc tenable.
    semaineType: {
      LUNDI: [
        { debutHeures: 8, debutMinutes: 30, finHeures: 17, finMinutes: 0 },
      ],
      MERCREDI: [
        { debutHeures: 8, debutMinutes: 30, finHeures: 17, finMinutes: 0 },
      ],
      VENDREDI: [
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

  it('sélectionne l’enfant par son id (référence), même si le prénom dénormalisé ne correspond plus', () => {
    // Un contrat dont le prénom stocké a divergé (ex. projection en retard) :
    // l'ancien rapprochement par prénom aurait vidé le select ; le lien par id
    // reste correct.
    render(
      <ContratForm
        foyerId="f1"
        enfants={enfantsTest}
        etablissements={etablissementsTest}
        contrat={{ ...contratEditeFactice, enfant: 'Ancien-Prénom' }}
        onCree={vi.fn()}
      />,
    );

    expect((screen.getByLabelText(/Enfant/i) as HTMLSelectElement).value).toBe(
      'e2',
    );
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

  // ---- Archivage réel (Lot 3) : sélecteur d'établissement ------------------

  it('exclut un établissement archivé des options d’un nouveau contrat', () => {
    render(
      <ContratForm
        foyerId="f1"
        enfants={enfantsTest}
        etablissements={[...etablissementsTest, etablissementArchive]}
        onCree={vi.fn()}
      />,
    );

    // L'actif reste proposé…
    expect(
      screen.getByRole('option', { name: /Crèche du Centre/i }),
    ).toBeInTheDocument();
    // …l'archivé n'apparaît pas (plus proposable pour un nouveau rattachement).
    expect(
      screen.queryByRole('option', { name: /Crèche Fermée/i }),
    ).not.toBeInTheDocument();
  });

  it('conserve l’option archivée sélectionnée en édition d’un contrat qui la référence', () => {
    render(
      <ContratForm
        foyerId="f1"
        enfants={enfantsTest}
        etablissements={[...etablissementsTest, etablissementArchive]}
        contrat={{ ...contratEditeFactice, etablissementId: 'et-arch' }}
        onCree={vi.fn()}
      />,
    );

    // L'option archivée reste présente (suffixe « (archivé) ») pour rester affichée…
    expect(
      screen.getByRole('option', { name: /Crèche Fermée \(archivé\)/i }),
    ).toBeInTheDocument();
    // …et sélectionnée (on ne casse pas un contrat existant).
    expect(
      (screen.getByLabelText(/Établissement/i) as HTMLSelectElement).value,
    ).toBe('et-arch');
  });

  it('renomme l’option de création à la volée (« Créer une nouvelle crèche / école »)', () => {
    render(
      <ContratForm
        foyerId="f1"
        enfants={enfantsTest}
        etablissements={etablissementsTest}
        onCree={vi.fn()}
      />,
    );

    expect(
      screen.getByRole('option', {
        name: /Créer une nouvelle crèche \/ école/i,
      }),
    ).toBeInTheDocument();
  });
});

/**
 * **Non-régression du défaut de production du 2026-08-29.** Le formulaire proposait
 * `1607` h annuelles par défaut — la durée légale annuelle du *travail* en France —
 * et ne confrontait jamais cette valeur à la semaine type saisie juste en dessous.
 * Un contrat de rentrée a ainsi été créé, depuis un compte parent, avec 1607 h pour
 * 27 h/semaine : 59,5 semaines de garde, et une mensualisation surévaluée d'environ
 * 27 %. Les heures se DÉRIVENT désormais, et l'impossible est refusé avant l'envoi.
 *
 * Ces tests ont aussi mis au jour un second défaut, corrigé ici : les quatre jours
 * cochés à l'ouverture n'avaient **aucune plage horaire** — les 8 h 00 → 17 h 30
 * affichés n'étaient qu'un décor, et un contrat créé sans toucher aux horaires
 * partait avec une semaine type entièrement vide.
 */
describe('ContratForm — heures annuelles dérivées de la semaine type', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  /**
   * Ramène la saisie à la forme réelle du contrat de production : période du
   * 01/09/2026 au 23/07/2027 et **trois** jours gardés. Le formulaire en coche
   * quatre par défaut (lundi, mardi, jeudi, vendredi) : on décoche le vendredi.
   */
  function saisirRentree(): void {
    fireEvent.change(screen.getByLabelText(/Valide du/i), {
      target: { value: '2026-09-01' },
    });
    fireEvent.change(screen.getByLabelText(/Valide au/i), {
      target: { value: '2027-07-23' },
    });
    fireEvent.click(screen.getByRole('checkbox', { name: 'Vendredi' }));
  }

  it('les jours cochés par défaut portent une VRAIE plage horaire', async () => {
    // Le défaut : quatre jours cochés, aucune plage — la semaine type partait vide.
    mockedApi.creerContrat.mockResolvedValue(contratVueFactice);
    rendu();
    fireEvent.change(screen.getByLabelText(/Valide du/i), {
      target: { value: '2026-09-01' },
    });
    choisirEtablissement();
    fireEvent.click(screen.getByRole('button', { name: /Créer le contrat/i }));

    await waitFor(() => {
      expect(mockedApi.creerContrat).toHaveBeenCalled();
    });
    const appel = mockedApi.creerContrat.mock.calls[0] as unknown[];
    const saisie = appel[0] as { semaineType: Record<string, unknown[]> };
    expect(saisie.semaineType['LUNDI']).toHaveLength(1);
    expect(saisie.semaineType['VENDREDI']).toHaveLength(1);
    expect(saisie.semaineType['MERCREDI']).toHaveLength(0);
  });

  it('DÉRIVE les heures depuis les jours cochés et la période', async () => {
    rendu();
    // Avant toute saisie de période, le champ porte encore la valeur héritée.
    expect(screen.getByLabelText(/Heures annuelles/i)).toHaveValue(1607);

    saisirRentree();

    // 46 lundis + 47 mardis + 47 jeudis sur la période, à 9 h 30 = 1330 h.
    await waitFor(() => {
      expect(screen.getByLabelText(/Heures annuelles/i)).toHaveValue(1330);
    });
    expect(
      screen.getByText(/Calculé depuis votre semaine type et la période/i),
    ).toBeInTheDocument();
  });

  it('REFUSE 1607 h saisies à la main, sans appeler l’API', async () => {
    rendu();
    saisirRentree();
    await waitFor(() => {
      expect(screen.getByLabelText(/Heures annuelles/i)).toHaveValue(1330);
    });

    // Le parent réécrit la valeur par défaut historique : elle est impossible.
    fireEvent.change(screen.getByLabelText(/Heures annuelles/i), {
      target: { value: '1607' },
    });
    choisirEtablissement();
    fireEvent.click(screen.getByRole('button', { name: /Créer le contrat/i }));

    // 1607 ÷ 28,5 h/semaine = 56,39 semaines : plus qu'une année n'en contient.
    expect(
      await screen.findByText(/56,39 semaines de garde/i),
    ).toBeInTheDocument();
    expect(mockedApi.creerContrat).not.toHaveBeenCalled();
  });

  it('ne réécrit plus la valeur dès que le parent l’a saisie à la main', async () => {
    rendu();
    saisirRentree();
    await waitFor(() => {
      expect(screen.getByLabelText(/Heures annuelles/i)).toHaveValue(1330);
    });

    fireEvent.change(screen.getByLabelText(/Heures annuelles/i), {
      target: { value: '1100' },
    });
    // Raccourcir la période change le plafond : la valeur saisie doit SURVIVRE,
    // sinon corriger le chiffre à la main serait impossible.
    fireEvent.change(screen.getByLabelText(/Valide au/i), {
      target: { value: '2027-06-30' },
    });

    await waitFor(() => {
      expect(screen.getByLabelText(/Heures annuelles/i)).toHaveValue(1100);
    });
  });

  it('accepte une valeur sous le plafond et envoie la saisie', async () => {
    mockedApi.creerContrat.mockResolvedValue({
      ...contratVueFactice,
      valideDu: '2026-09-01',
      valideAu: '2027-07-23',
    });
    rendu();
    saisirRentree();
    await waitFor(() => {
      expect(screen.getByLabelText(/Heures annuelles/i)).toHaveValue(1330);
    });

    fireEvent.change(screen.getByLabelText(/Heures annuelles/i), {
      target: { value: '1150' },
    });
    choisirEtablissement();
    fireEvent.click(screen.getByRole('button', { name: /Créer le contrat/i }));

    await waitFor(() => {
      expect(mockedApi.creerContrat).toHaveBeenCalledWith(
        expect.objectContaining({ heuresAnnuellesContractualisees: 1150 }),
      );
    });
  });
});
