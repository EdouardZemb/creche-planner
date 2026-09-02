import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  UnitesAssociativesPage,
  formaterHeures,
  phraseEcheance,
} from './UnitesAssociativesPage';
import type { SuiviUaVue } from '../types/bff';

// `ApiError` est REDÉCLARÉE dans le double : `utils/erreurs` en fait un
// `instanceof`, et un module mocké qui ne l'exporte pas rend l'opérande droit
// `undefined` — le `catch` lève alors lui-même, et l'écran n'affiche rien.
vi.mock('../api/client', () => ({
  api: {
    lireSuiviUnitesAssociatives: vi.fn(),
    declarerEngagementUa: vi.fn(),
    ajouterSessionUa: vi.fn(),
    modifierSessionUa: vi.fn(),
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

const FOYER = 'foyer-1';

function suivi(surcharge: Partial<SuiviUaVue> = {}): SuiviUaVue {
  return {
    foyerId: FOYER,
    aujourdhui: '2026-10-01',
    engagement: {
      id: 'eng-1',
      foyerId: FOYER,
      debut: '2026-06-01',
      fin: '2027-05-31',
      quotaHeures: 20,
      valeurUaCentimes: 3125,
      cautionCentimes: 62500,
    },
    compteurs: {
      quotaHeures: 20,
      heuresRealisees: 6,
      heuresReservees: 3,
      heuresAConfirmer: 0,
      heuresRestantes: 11,
      quotaAtteint: false,
      joursAvantEcheance: 242,
      coutSiArret: { montantCentimes: 43750, hypothese: 'SI_TU_TARRETES_LA' },
      coutSiReservationsRealisees: {
        montantCentimes: 34375,
        hypothese: 'SI_TU_REALISES_TES_RESERVATIONS',
      },
      alerteEcheance: false,
    },
    sessions: [
      {
        id: 's-1',
        engagementId: 'eng-1',
        date: '2026-11-07',
        dureeHeures: 3,
        type: 'MENAGE',
        realisePar: 'Camille',
        etablissementId: null,
        etat: 'PREVUE',
        aConfirmer: false,
      },
    ],
    seuilAlerteJours: 56,
    ...surcharge,
  } as SuiviUaVue;
}

/**
 * Compteurs et première session du jeu de référence, **dénullifiés une fois** :
 * `suivi()` les type `| null` (l'API rend `null` quand aucune période n'est
 * déclarée), et les affirmer à chaque usage sèmerait des `!` dans tout le fichier.
 */
const COMPTEURS = suivi().compteurs as NonNullable<SuiviUaVue['compteurs']>;
const PREMIERE_SESSION = suivi().sessions[0] as SuiviUaVue['sessions'][number];

function rendre() {
  return render(
    <MemoryRouter initialEntries={[`/foyers/${FOYER}/unites-associatives`]}>
      <Routes>
        <Route
          path="/foyers/:foyerId/unites-associatives"
          element={<UnitesAssociativesPage />}
        />
      </Routes>
    </MemoryRouter>,
  );
}

describe('UnitesAssociativesPage · les trois compteurs (US-40-04)', () => {
  beforeEach(() => {
    vi.mocked(api.lireSuiviUnitesAssociatives).mockReset();
    vi.mocked(api.modifierSessionUa).mockReset();
    vi.mocked(api.ajouterSessionUa).mockReset();
    vi.mocked(api.declarerEngagementUa).mockReset();
  });

  it('affiche réalisé, réservé et restant DISTINCTEMENT, avec leur définition', async () => {
    vi.mocked(api.lireSuiviUnitesAssociatives).mockResolvedValue(suivi());
    rendre();

    await screen.findByRole('heading', { name: 'Où j’en suis' });
    // Trois compteurs nommés, trois valeurs différentes : les confondre est la
    // première erreur d'écran possible (SFD 40 §3.1).
    expect(screen.getByRole('heading', { name: 'Réalisé' })).toBeTruthy();
    expect(screen.getByRole('heading', { name: 'Réservé' })).toBeTruthy();
    expect(screen.getByRole('heading', { name: 'Restant' })).toBeTruthy();
    expect(screen.getByText('6 h')).toBeTruthy();
    expect(screen.getByText('3 h')).toBeTruthy();
    expect(screen.getByText('11 h')).toBeTruthy();
    expect(
      screen.getByText(/Seul compteur qui solde l’obligation/),
    ).toBeTruthy();
  });

  it('affiche chaque coût projeté AVEC son hypothèse (RM-40-05)', async () => {
    vi.mocked(api.lireSuiviUnitesAssociatives).mockResolvedValue(suivi());
    rendre();

    await screen.findByText('437,50 €');
    expect(screen.getByText('si tu t’arrêtes là')).toBeTruthy();
    expect(screen.getByText('343,75 €')).toBeTruthy();
    expect(
      screen.getByText('si tu réalises tes créneaux déjà réservés'),
    ).toBeTruthy();
  });

  it('dit « caution rendue, 0 € » quand le quota est atteint (CA3)', async () => {
    vi.mocked(api.lireSuiviUnitesAssociatives).mockResolvedValue(
      suivi({
        compteurs: {
          ...COMPTEURS,
          heuresRealisees: 20,
          heuresRestantes: 0,
          quotaAtteint: true,
          coutSiArret: { montantCentimes: 0, hypothese: 'SI_TU_TARRETES_LA' },
        },
      }),
    );
    rendre();

    // Le SENS métier, pas un zéro nu.
    expect(await screen.findByTestId('quota-atteint-ua')).toBeTruthy();
    expect(screen.getByText(/caution rendue/)).toBeTruthy();
    expect(screen.queryByText('si tu t’arrêtes là')).toBeNull();
  });

  it('signale les heures « à confirmer » sans les compter comme faites (RM-40-06)', async () => {
    vi.mocked(api.lireSuiviUnitesAssociatives).mockResolvedValue(
      suivi({
        compteurs: { ...COMPTEURS, heuresAConfirmer: 4 },
        sessions: [
          {
            ...PREMIERE_SESSION,
            date: '2026-09-12',
            aConfirmer: true,
          },
        ],
      }),
    );
    rendre();

    expect(await screen.findByTestId('a-confirmer-ua')).toBeTruthy();
    expect(screen.getByText('À confirmer')).toBeTruthy();
  });

  it('affiche l’échéance et l’alerte quand elle approche (US-40-05 CA1)', async () => {
    vi.mocked(api.lireSuiviUnitesAssociatives).mockResolvedValue(
      suivi({
        compteurs: {
          ...COMPTEURS,
          joursAvantEcheance: 30,
          alerteEcheance: true,
        },
      }),
    );
    rendre();

    expect((await screen.findByTestId('echeance-ua')).textContent).toContain(
      'dans 30 jours',
    );
    expect(screen.getByTestId('alerte-ua')).toBeTruthy();
  });

  it('n’alerte pas quand l’échéance est lointaine', async () => {
    vi.mocked(api.lireSuiviUnitesAssociatives).mockResolvedValue(suivi());
    rendre();

    await screen.findByTestId('echeance-ua');
    expect(screen.queryByTestId('alerte-ua')).toBeNull();
  });
});

describe('UnitesAssociativesPage · la frontière (RM-40-01)', () => {
  beforeEach(() => {
    vi.mocked(api.lireSuiviUnitesAssociatives).mockReset();
  });

  it('écrit à l’écran que Martha ne réserve rien', async () => {
    vi.mocked(api.lireSuiviUnitesAssociatives).mockResolvedValue(suivi());
    rendre();

    const mention = await screen.findByTestId('frontiere-site-travaux');
    expect(mention.textContent).toContain('Martha ne réserve aucun créneau');
    expect(mention.textContent).toContain('site travaux');
  });
});

describe('UnitesAssociativesPage · gestes', () => {
  beforeEach(() => {
    vi.mocked(api.lireSuiviUnitesAssociatives).mockReset();
    vi.mocked(api.modifierSessionUa).mockReset();
    vi.mocked(api.declarerEngagementUa).mockReset();
  });

  it('marque une session réalisée et recharge le suivi', async () => {
    vi.mocked(api.lireSuiviUnitesAssociatives).mockResolvedValue(suivi());
    vi.mocked(api.modifierSessionUa).mockResolvedValue({} as never);
    rendre();

    fireEvent.click(await screen.findByRole('button', { name: 'C’est fait' }));

    await waitFor(() => {
      expect(api.modifierSessionUa).toHaveBeenCalledWith(FOYER, 's-1', {
        etat: 'REALISEE',
      });
    });
  });

  it('annule une session sans la supprimer (la trace du créneau reste)', async () => {
    vi.mocked(api.lireSuiviUnitesAssociatives).mockResolvedValue(suivi());
    vi.mocked(api.modifierSessionUa).mockResolvedValue({} as never);
    rendre();

    fireEvent.click(await screen.findByRole('button', { name: 'Annulé' }));

    await waitFor(() => {
      expect(api.modifierSessionUa).toHaveBeenCalledWith(FOYER, 's-1', {
        etat: 'ANNULEE',
      });
    });
  });

  it('remonte l’erreur d’une mutation refusée', async () => {
    vi.mocked(api.lireSuiviUnitesAssociatives).mockResolvedValue(suivi());
    vi.mocked(api.modifierSessionUa).mockRejectedValue(
      new Error('session introuvable'),
    );
    rendre();

    fireEvent.click(await screen.findByRole('button', { name: 'C’est fait' }));

    expect(await screen.findByTestId('erreur-ua')).toBeTruthy();
  });
});

describe('UnitesAssociativesPage · aucune période déclarée', () => {
  beforeEach(() => {
    vi.mocked(api.lireSuiviUnitesAssociatives).mockReset();
    vi.mocked(api.declarerEngagementUa).mockReset();
  });

  it('propose la déclaration plutôt que trois zéros trompeurs', async () => {
    vi.mocked(api.lireSuiviUnitesAssociatives).mockResolvedValue(
      suivi({ engagement: null, compteurs: null, sessions: [] }),
    );
    rendre();

    await screen.findByRole('heading', { name: 'Déclarer la période' });
    expect(screen.queryByRole('heading', { name: 'Réalisé' })).toBeNull();
    // Les valeurs du RI sont PROPOSÉES, pas imposées (RM-40-02).
    expect(screen.getByText(/proposées/)).toBeTruthy();
    expect(
      (screen.getByLabelText(/Quota d’unités associatives/) as HTMLInputElement)
        .value,
    ).toBe('20');
    expect(
      (screen.getByLabelText(/Valeur d’une unité/) as HTMLInputElement).value,
    ).toBe('31.25');
  });

  it('déclare la période avec les valeurs de l’écran, en centimes', async () => {
    vi.mocked(api.lireSuiviUnitesAssociatives).mockResolvedValue(
      suivi({ engagement: null, compteurs: null, sessions: [] }),
    );
    vi.mocked(api.declarerEngagementUa).mockResolvedValue({} as never);
    rendre();

    fireEvent.click(
      await screen.findByRole('button', { name: 'Déclarer cette période' }),
    );

    await waitFor(() => {
      expect(api.declarerEngagementUa).toHaveBeenCalledWith(FOYER, {
        debut: '2026-06-01',
        fin: '2027-05-31',
        quotaHeures: 20,
        valeurUaCentimes: 3125,
        cautionCentimes: 62500,
      });
    });
  });
});

describe('formaterHeures', () => {
  it('rend des heures entières sans décimale parasite', () => {
    expect(formaterHeures(20)).toBe('20 h');
    expect(formaterHeures(0)).toBe('0 h');
  });

  it('rend les demi-heures en minutes, pas en « 2.5 »', () => {
    expect(formaterHeures(2.5)).toBe('2 h 30');
    expect(formaterHeures(1.25)).toBe('1 h 15');
  });
});

describe('phraseEcheance', () => {
  it('dit la date ET le compte à rebours', () => {
    expect(phraseEcheance(30, '2027-05-31')).toBe(
      'Échéance le 31 mai 2027, dans 30 jours',
    );
  });

  it('accorde le singulier', () => {
    expect(phraseEcheance(1, '2027-05-31')).toContain('dans 1 jour');
  });

  it('dit « aujourd’hui » plutôt que « dans 0 jour »', () => {
    expect(phraseEcheance(0, '2027-05-31')).toContain('aujourd’hui');
  });

  it('dit qu’elle est dépassée plutôt que d’afficher un nombre négatif', () => {
    expect(phraseEcheance(-10, '2027-05-31')).toBe(
      'Échéance dépassée depuis le 31 mai 2027',
    );
  });
});

describe('UnitesAssociativesPage · états de la page', () => {
  beforeEach(() => {
    vi.mocked(api.lireSuiviUnitesAssociatives).mockReset();
  });

  it('annonce le chargement avant la première réponse', () => {
    vi.mocked(api.lireSuiviUnitesAssociatives).mockReturnValue(
      new Promise(() => undefined),
    );
    rendre();

    expect(screen.getByRole('status').textContent).toContain('Chargement');
  });

  it('propose de réessayer quand le suivi est indisponible', async () => {
    vi.mocked(api.lireSuiviUnitesAssociatives)
      .mockRejectedValueOnce(new Error('service indisponible'))
      .mockResolvedValue(suivi());
    rendre();

    const reessayer = await screen.findByRole('button', { name: 'Réessayer' });
    fireEvent.click(reessayer);

    // Le second appel réussit : l'écran de récupération cède la place au suivi.
    await screen.findByRole('heading', { name: 'Où j’en suis' });
  });

  it('dit où se prennent les créneaux quand aucun n’est encore noté', async () => {
    vi.mocked(api.lireSuiviUnitesAssociatives).mockResolvedValue(
      suivi({ sessions: [] }),
    );
    rendre();

    expect(
      (await screen.findByText(/Aucun créneau noté/)).textContent,
    ).toContain('site travaux');
  });

  it('distingue une session faite d’une session annulée', async () => {
    vi.mocked(api.lireSuiviUnitesAssociatives).mockResolvedValue(
      suivi({
        sessions: [
          { ...PREMIERE_SESSION, id: 's-1', etat: 'REALISEE' },
          { ...PREMIERE_SESSION, id: 's-2', etat: 'ANNULEE' },
        ],
      }),
    );
    rendre();

    expect(await screen.findByText('Fait')).toBeTruthy();
    expect(screen.getByText('Annulé')).toBeTruthy();
    // Ni l'une ni l'autre n'offre plus « C'est fait » : le geste est passé.
    expect(screen.queryByRole('button', { name: 'C’est fait' })).toBeNull();
  });
});

describe('UnitesAssociativesPage · noter un créneau (US-40-02 CA1)', () => {
  beforeEach(() => {
    vi.mocked(api.lireSuiviUnitesAssociatives).mockReset();
    vi.mocked(api.ajouterSessionUa).mockReset();
  });

  it('saisit les quatre champs et relaie la session, bornée à la période', async () => {
    vi.mocked(api.lireSuiviUnitesAssociatives).mockResolvedValue(suivi());
    vi.mocked(api.ajouterSessionUa).mockResolvedValue({} as never);
    rendre();

    const date = await screen.findByLabelText(/Date du créneau/);
    // La saisie ne peut pas sortir de la période déclarée : le service le
    // refuserait, l'écran l'empêche d'abord.
    expect(date.getAttribute('min')).toBe('2026-06-01');
    expect(date.getAttribute('max')).toBe('2027-05-31');

    fireEvent.change(date, { target: { value: '2026-10-17' } });
    fireEvent.change(screen.getByLabelText(/Durée/), {
      target: { value: '2.5' },
    });
    fireEvent.change(screen.getByLabelText(/Type de créneau/), {
      target: { value: 'CVE' },
    });
    fireEvent.change(screen.getByLabelText(/Qui s’y colle/), {
      target: { value: 'Camille' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Noter ce créneau' }));

    await waitFor(() => {
      expect(api.ajouterSessionUa).toHaveBeenCalledWith(FOYER, {
        engagementId: 'eng-1',
        date: '2026-10-17',
        dureeHeures: 2.5,
        type: 'CVE',
        realisePar: 'Camille',
      });
    });
  });

  it('omet « qui s’y colle » quand il est laissé vide (le reste est facultatif)', async () => {
    vi.mocked(api.lireSuiviUnitesAssociatives).mockResolvedValue(suivi());
    vi.mocked(api.ajouterSessionUa).mockResolvedValue({} as never);
    rendre();

    fireEvent.change(await screen.findByLabelText(/Date du créneau/), {
      target: { value: '2026-10-17' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Noter ce créneau' }));

    await waitFor(() => {
      expect(api.ajouterSessionUa).toHaveBeenCalledWith(
        FOYER,
        expect.not.objectContaining({ realisePar: expect.anything() }),
      );
    });
  });
});

describe('UnitesAssociativesPage · déclarer avec d’autres valeurs (RM-40-02)', () => {
  beforeEach(() => {
    vi.mocked(api.lireSuiviUnitesAssociatives).mockReset();
    vi.mocked(api.declarerEngagementUa).mockReset();
  });

  it('accepte un quota et une valeur d’UA corrigés par le parent', async () => {
    vi.mocked(api.lireSuiviUnitesAssociatives).mockResolvedValue(
      suivi({ engagement: null, compteurs: null, sessions: [] }),
    );
    vi.mocked(api.declarerEngagementUa).mockResolvedValue({} as never);
    rendre();

    fireEvent.change(
      await screen.findByLabelText(/Quota d’unités associatives/),
      { target: { value: '10' } },
    );
    fireEvent.change(screen.getByLabelText(/Valeur d’une unité/), {
      target: { value: '40' },
    });
    fireEvent.change(screen.getByLabelText(/Caution déposée/), {
      target: { value: '0' },
    });
    fireEvent.change(screen.getByLabelText(/Début de période/), {
      target: { value: '2026-09-01' },
    });
    fireEvent.change(screen.getByLabelText(/Fin de période/), {
      target: { value: '2027-08-31' },
    });
    fireEvent.click(
      screen.getByRole('button', { name: 'Déclarer cette période' }),
    );

    await waitFor(() => {
      expect(api.declarerEngagementUa).toHaveBeenCalledWith(FOYER, {
        debut: '2026-09-01',
        fin: '2027-08-31',
        quotaHeures: 10,
        valeurUaCentimes: 4000,
        cautionCentimes: 0,
      });
    });
  });
});

// La période proposée à la déclaration est calée sur l'année ASSOCIATIVE
// (1er juin → 31 mai), pas sur l'année civile. Le seul test existant tombait en
// octobre, du bon côté du 1er juin : la branche « on est avant juin, donc la
// période a commencé l'an dernier » n'était jamais prise — et c'est justement
// celle qui décide de l'échéance affichée à un parent qui déclare en mars.
describe('UnitesAssociativesPage · la période proposée court du 1er juin au 31 mai', () => {
  beforeEach(() => {
    vi.mocked(api.lireSuiviUnitesAssociatives).mockReset();
    vi.mocked(api.declarerEngagementUa).mockReset();
  });

  /** Déclare sans rien changer, et rend le corps envoyé au BFF. */
  async function declarerDepuis(aujourdhui: string) {
    vi.mocked(api.lireSuiviUnitesAssociatives).mockResolvedValue(
      suivi({ aujourdhui, engagement: null, compteurs: null, sessions: [] }),
    );
    vi.mocked(api.declarerEngagementUa).mockResolvedValue({} as never);
    rendre();

    fireEvent.click(
      await screen.findByRole('button', { name: 'Déclarer cette période' }),
    );

    await waitFor(() => {
      expect(api.declarerEngagementUa).toHaveBeenCalled();
    });
    return vi.mocked(api.declarerEngagementUa).mock.calls[0]?.[1];
  }

  it('en mars, propose la période OUVERTE l’an dernier (échéance au 31/05 qui vient)', async () => {
    // Mars 2027 : la période courante a commencé le 1er juin 2026 et s'achève
    // dans moins de trois mois. Proposer « 2027-06-01 → 2028-05-31 » ferait
    // déclarer la période SUIVANTE et rendrait l'échéance muette.
    expect(await declarerDepuis('2027-03-15')).toMatchObject({
      debut: '2026-06-01',
      fin: '2027-05-31',
    });
  });

  it('le 31 mai, la période court toujours — elle s’achève ce jour-là', async () => {
    expect(await declarerDepuis('2027-05-31')).toMatchObject({
      debut: '2026-06-01',
      fin: '2027-05-31',
    });
  });

  it('le 1er juin, la période bascule sur la suivante (bord inclus)', async () => {
    expect(await declarerDepuis('2027-06-01')).toMatchObject({
      debut: '2027-06-01',
      fin: '2028-05-31',
    });
  });
});

describe('UnitesAssociativesPage · un type de créneau inconnu du catalogue', () => {
  beforeEach(() => {
    vi.mocked(api.lireSuiviUnitesAssociatives).mockReset();
  });

  it('affiche le code brut plutôt qu’une ligne amputée de son type', async () => {
    // Le catalogue de l'écran est une COPIE de `TYPES_SESSION_UA` : le jour où
    // le domaine en ajoute un, l'écran ne doit pas afficher un créneau sans
    // libellé — il montre le code, qui reste lisible.
    vi.mocked(api.lireSuiviUnitesAssociatives).mockResolvedValue(
      suivi({
        sessions: [{ ...PREMIERE_SESSION, type: 'JARDINAGE' }],
      }),
    );
    rendre();

    expect(await screen.findByText(/JARDINAGE/)).toBeTruthy();
  });
});
