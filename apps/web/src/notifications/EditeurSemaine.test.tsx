import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { EditeurSemaine } from './EditeurSemaine';
import type {
  SemaineBesoins,
  ValidationResultat,
  Brouillon,
} from '../types/bff';

vi.mock('../api/client', () => ({
  api: {
    lireSemaineBesoins: vi.fn(),
    ecrireSemaineBesoins: vi.fn(),
    validerSemaine: vi.fn(),
    lireBrouillon: vi.fn(),
    envoyerRecap: vi.fn(),
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

const VUE: SemaineBesoins = {
  semaineIso: '2026-W27',
  jours: JOURS,
  etablissements: [
    {
      cle: 'CRECHE_HIRONDELLES',
      libelle: 'Crèche Les Hirondelles',
      preavisRegle: { type: 'JOURS_OUVRES', valeur: 2 },
    },
    {
      cle: 'ABCM',
      libelle: 'École ABCM',
      preavisRegle: { type: 'JOUR_HEURE', jour: 'JEUDI', heure: '12:00' },
    },
  ],
  contrats: [
    {
      contratId: 'c-lea',
      enfant: 'Léa',
      mode: 'CRECHE_PSU',
      etablissementCle: 'CRECHE_HIRONDELLES',
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
          exceptions: [],
          joursAlsh: [],
        },
      },
    },
    {
      contratId: 'c-tom',
      enfant: 'Tom',
      mode: 'CANTINE',
      etablissementCle: 'ABCM',
      besoins: {},
    },
  ],
};

const BROUILLON: Brouillon = {
  contratId: 'c-lea',
  semaineIso: '2026-W27',
  etablissementCle: 'CRECHE_HIRONDELLES',
  etablissementLibelle: 'Crèche Les Hirondelles',
  destinataire: 'contact-creche@example.org',
  sujet: 'Planning de Léa — semaine 2026-W27 : modifications',
  corps: '<p>Bonjour</p>',
  texte: 'Bonjour',
  deltaModifs: { jours: [{ date: '2026-06-29', avant: null, apres: {} }] },
  dryRun: true,
};

describe('EditeurSemaine', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(api.lireSemaineBesoins).mockResolvedValue(VUE);
    vi.mocked(api.ecrireSemaineBesoins).mockResolvedValue(undefined);
    vi.mocked(api.lireBrouillon).mockResolvedValue(BROUILLON);
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
    expect(screen.getByText(/Léa — Crèche PSU/)).toBeInTheDocument();
    expect(screen.getByText(/Tom — Cantine/)).toBeInTheDocument();
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

    // Bascule en « Jour ajouté » puis confirme.
    await user.click(screen.getByLabelText('Jour ajouté'));
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

    await screen.findByText(/Léa — Crèche PSU/);
    // Léa (Crèche Les Hirondelles) est le premier bloc contrat → premier « Valider ».
    const validers = screen.getAllByRole('button', { name: 'Valider' });
    await user.click(validers[0]!);

    await waitFor(() => {
      expect(api.validerSemaine).toHaveBeenCalledWith('c-lea', '2026-W27');
    });
    expect(
      await screen.findByText(/validée \(avec modifications\)/i),
    ).toBeInTheDocument();
    // Le récap au service apparaît (RelectureEnvoi).
    expect(
      await screen.findByText(/Envoyer le récapitulatif au service/i),
    ).toBeInTheDocument();
  });
});
