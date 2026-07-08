import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { EditeurSemaine } from './EditeurSemaine';
import type {
  SemaineBesoins,
  ValidationResultat,
  BrouillonEtablissement,
} from '../types/bff';

vi.mock('../api/client', () => ({
  api: {
    lireSemaineBesoins: vi.fn(),
    ecrireSemaineBesoins: vi.fn(),
    validerSemaine: vi.fn(),
    lireBrouillonEtablissement: vi.fn(),
    envoyerRecapEtablissement: vi.fn(),
  },
  ApiError: class ApiError extends Error {},
}));

import { api } from '../api/client';

const JOURS = [
  '2026-06-29',
  '2026-06-30',
  '2026-07-01',
  '2026-07-02',
  '2026-07-03',
  '2026-07-04',
  '2026-07-05',
];

// Établissements réels (entité libre) : groupés par `etablissementId` (P3).
const ID_CRECHE = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const ID_ABCM = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';

const VUE: SemaineBesoins = {
  semaineIso: '2026-W27',
  jours: JOURS,
  etablissements: [
    {
      etablissementId: ID_CRECHE,
      libelle: 'Crèche Les Hirondelles',
      preavisRegle: { type: 'JOURS_OUVRES', valeur: 2 },
    },
    {
      etablissementId: ID_ABCM,
      libelle: 'École ABCM',
      preavisRegle: { type: 'JOUR_HEURE', jour: 'JEUDI', heure: '12:00' },
    },
  ],
  contrats: [
    {
      contratId: 'c-lea',
      enfant: 'Léa',
      mode: 'CRECHE_PSU',
      etablissementId: ID_CRECHE,
      // Planning de base : gardée le mardi 08:00–17:00 (affiché sans ouvrir la saisie).
      semaineType: {
        MARDI: [
          { debutHeures: 8, debutMinutes: 0, finHeures: 17, finMinutes: 0 },
        ],
      },
      besoins: {
        '2026-06-29': {
          joursSupplementaires: [],
          absences: [
            {
              date: '2026-06-29',
              debutHeures: 9,
              debutMinutes: 0,
              finHeures: 16,
              finMinutes: 30,
              preavisJours: 0,
              certificatMaladie: false,
            },
          ],
          ajustements: [],
          exceptions: [],
          joursAlsh: [],
        },
      },
    },
    {
      contratId: 'c-tom',
      enfant: 'Tom',
      mode: 'CANTINE',
      etablissementId: ID_ABCM,
      besoins: {},
    },
  ],
};

/** Brouillon agrégé par établissement, paramétré par l'`id` demandé (P3). */
function brouillonPour(etablissementId: string): BrouillonEtablissement {
  const concerne = etablissementId === ID_CRECHE;
  return {
    foyerId: 'foyer-1',
    semaineIso: '2026-W27',
    etablissementId,
    etablissementLibelle: concerne ? 'Crèche Les Hirondelles' : 'École ABCM',
    destinataire: concerne
      ? 'contact-creche@example.org'
      : 'contact-abcm@example.org',
    sujet: 'Plannings modifiés — semaine du 29 juin au 5 juillet 2026',
    corps: '<p>Bonjour</p>',
    texte: 'Bonjour',
    // Seule la crèche a un enfant concerné dans ces tests.
    enfants: concerne
      ? [
          {
            contratId: 'c-lea',
            enfant: 'Léa',
            deltaModifs: {
              jours: [{ date: '2026-06-29', avant: null, apres: {} }],
            },
          },
        ]
      : [],
    dryRun: true,
  };
}

describe('EditeurSemaine', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(api.lireSemaineBesoins).mockResolvedValue(VUE);
    vi.mocked(api.ecrireSemaineBesoins).mockResolvedValue(undefined);
    vi.mocked(api.lireBrouillonEtablissement).mockImplementation(
      (_foyerId, _semaineIso, etablissementId) =>
        Promise.resolve(brouillonPour(etablissementId)),
    );
  });

  function rendre() {
    return render(
      <EditeurSemaine
        foyerId="foyer-1"
        semaineIso="2026-W27"
        onFermer={vi.fn()}
      />,
    );
  }

  it('charge la semaine et groupe les contrats par établissement et enfant', async () => {
    rendre();

    await waitFor(() => {
      expect(api.lireSemaineBesoins).toHaveBeenCalledWith(
        'foyer-1',
        '2026-W27',
        {
          signal: expect.anything(),
        },
      );
    });

    expect(
      await screen.findByText('Crèche Les Hirondelles'),
    ).toBeInTheDocument();
    expect(screen.getByText('École ABCM')).toBeInTheDocument();
    expect(screen.getByText(/Léa — Crèche/)).toBeInTheDocument();
    expect(screen.getByText(/Tom — Cantine/)).toBeInTheDocument();
  });

  it('affiche les horaires planifiés (semaine-type) sans ouvrir la saisie', async () => {
    rendre();
    // Le mardi 30/06 n'a aucune exception → l'horaire de base du contrat s'affiche
    // directement dans la rangée du jour (« Gardé 08:00–17:00 »).
    expect(await screen.findByText('Gardé 08:00–17:00')).toBeInTheDocument();
  });

  it('appelle ecrireSemaineBesoins après l’édition d’un jour (debounce)', async () => {
    const user = userEvent.setup();
    rendre();

    // La rangée du 29/06 de Léa porte déjà une absence → bouton « Modifier »
    // (aria-label unique : le même jour existe aussi chez Tom, mais en « Saisir »).
    await user.click(
      await screen.findByRole('button', {
        name: 'Modifier le Lundi 29/06/2026',
      }),
    );

    // Le 29/06 n'est pas gardé (semaine-type au mardi) : la modale ouvre
    // directement la saisie d'un « jour ajouté ». Confirmer l'enregistre.
    await user.click(screen.getByRole('button', { name: 'Confirmer' }));

    // Le debounce (800 ms) écoulé, l'écriture part avec les besoins de la semaine :
    // le 29/06 devient un jour ajouté, l'absence d'origine disparaît.
    await waitFor(
      () => {
        expect(api.ecrireSemaineBesoins).toHaveBeenCalled();
      },
      { timeout: 2000 },
    );
    const [, semaine, corps] = vi.mocked(api.ecrireSemaineBesoins).mock
      .calls[0]!;
    expect(semaine).toBe('2026-W27');
    expect(corps).toMatchObject({
      joursSupplementaires: [{ date: '2026-06-29' }],
    });
    expect(corps.absences ?? []).toHaveLength(0);
  });

  it('valide un contrat et propose le récap quand il y a des modifications', async () => {
    const resultat: ValidationResultat = {
      contratId: 'c-lea',
      semaineIso: '2026-W27',
      statut: 'VALIDEE_AVEC_MODIFS',
      deltaModifs: { jours: [{ date: '2026-06-29', avant: null, apres: {} }] },
    };
    vi.mocked(api.validerSemaine).mockResolvedValue(resultat);

    const user = userEvent.setup();
    rendre();

    await screen.findByText(/Léa — Crèche/);
    // Chaque bloc contrat porte son propre « Valider » : l'aria-label suffixé
    // enfant/mode permet de cibler celui de Léa sans compter sur l'ordre DOM.
    await user.click(
      screen.getByRole('button', {
        name: 'Valider la semaine du 29 juin au 5 juillet — Léa, Crèche',
      }),
    );

    await waitFor(() => {
      expect(api.validerSemaine).toHaveBeenCalledWith('c-lea', '2026-W27');
    });
    expect(
      await screen.findByText(/validée \(avec modifications\)/i),
    ).toBeInTheDocument();
    // Le récap **agrégé par établissement** apparaît (RelectureEnvoi), avec un bloc
    // d'envoi pour la crèche (seul établissement concerné ici).
    expect(
      await screen.findByText(/Dernière étape : prévenir les services/i),
    ).toBeInTheDocument();
    expect(
      await screen.findByRole('button', {
        name: /Envoyer le récapitulatif à Crèche Les Hirondelles/i,
      }),
    ).toBeInTheDocument();
  });
});
