import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { EncartValidation } from './EncartValidation';
import type { NotificationAValider, ValidationResultat } from '../types/bff';

vi.mock('../api/client', () => ({
  api: {
    listerAValider: vi.fn(),
    validerSemaine: vi.fn(),
    lireBrouillonEtablissement: vi.fn(),
    envoyerRecapEtablissement: vi.fn(),
    // Ouvrir l'éditeur hebdomadaire (Phase 3) charge la vue consolidée.
    lireSemaineBesoins: vi.fn(),
    ecrireSemaineBesoins: vi.fn(),
  },
  ApiError: class ApiError extends Error {},
}));

import { api } from '../api/client';

/** Brouillon agrégé renvoyé à la `RelectureEnvoi` montée après une validation. */
function brouillonPour(cle: string) {
  return {
    foyerId: 'foyer-1',
    semaineIso: '2026-W27',
    etablissementCle: cle as 'CRECHE_HIRONDELLES' | 'ABCM',
    etablissementLibelle:
      cle === 'CRECHE_HIRONDELLES' ? 'Crèche Les Hirondelles' : 'École ABCM',
    destinataire:
      cle === 'CRECHE_HIRONDELLES'
        ? 'contact-creche@example.org'
        : 'contact-abcm@example.org',
    sujet: 'Plannings modifiés — semaine 2026-W27',
    corps: '<p>Bonjour</p>',
    texte: 'Bonjour',
    enfants:
      cle === 'CRECHE_HIRONDELLES'
        ? [
            {
              contratId: '55555555-0000-4000-8000-000000000000',
              enfant: 'Léa',
              deltaModifs: {
                jours: [{ date: '2026-07-01', avant: null, apres: {} }],
              },
            },
          ]
        : [],
    dryRun: true,
  };
}

const A_VALIDER: NotificationAValider[] = [
  {
    contratId: '55555555-0000-4000-8000-000000000000',
    foyerId: 'foyer-1',
    semaineIso: '2026-W27',
    statut: 'A_VALIDER',
    notifieeLe: '2026-06-23T06:00:00.000Z',
  },
];

const SEMAINE_BESOINS = {
  semaineIso: '2026-W27',
  jours: [
    '2026-06-29',
    '2026-06-30',
    '2026-07-01',
    '2026-07-02',
    '2026-07-03',
    '2026-07-04',
    '2026-07-05',
  ],
  etablissements: [
    {
      cle: 'CRECHE_HIRONDELLES' as const,
      libelle: 'Crèche Les Hirondelles',
      preavisRegle: { type: 'JOURS_OUVRES' as const, valeur: 2 },
    },
  ],
  contrats: [
    {
      contratId: '55555555-0000-4000-8000-000000000000',
      enfant: 'Léa',
      mode: 'CRECHE_PSU' as const,
      etablissementCle: 'CRECHE_HIRONDELLES' as const,
      besoins: {},
    },
  ],
};

describe('EncartValidation', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(api.lireBrouillonEtablissement).mockImplementation(
      (_foyerId, _semaineIso, cle) => Promise.resolve(brouillonPour(cle)),
    );
    vi.mocked(api.lireSemaineBesoins).mockResolvedValue(SEMAINE_BESOINS);
  });

  it('ne rend rien quand il n’y a aucune semaine à valider', async () => {
    vi.mocked(api.listerAValider).mockResolvedValue([]);
    const { container } = render(<EncartValidation foyerId="foyer-1" />);
    await waitFor(() => {
      expect(api.listerAValider).toHaveBeenCalledWith('foyer-1', {
        signal: expect.anything(),
      });
    });
    expect(
      screen.queryByText(/Valider la semaine suivante/i),
    ).not.toBeInTheDocument();
    expect(container.querySelector('section')).toBeNull();
  });

  it('liste les semaines à valider avec un libellé lisible', async () => {
    vi.mocked(api.listerAValider).mockResolvedValue(A_VALIDER);
    render(<EncartValidation foyerId="foyer-1" />);

    expect(
      await screen.findByText(/Valider la semaine suivante/i),
    ).toBeInTheDocument();
    expect(
      screen.getByText(/Planning de la semaine 27 \(2026\)/),
    ).toBeInTheDocument();
  });

  it('valide une semaine et signale les modifications', async () => {
    vi.mocked(api.listerAValider).mockResolvedValue(A_VALIDER);
    const resultat: ValidationResultat = {
      contratId: A_VALIDER[0]!.contratId,
      semaineIso: '2026-W27',
      statut: 'VALIDEE_AVEC_MODIFS',
      deltaModifs: { jours: [{ date: '2026-07-01', avant: null, apres: {} }] },
    };
    vi.mocked(api.validerSemaine).mockResolvedValue(resultat);

    render(<EncartValidation foyerId="foyer-1" />);
    const bouton = await screen.findByRole('button', { name: 'Valider' });
    fireEvent.click(bouton);

    await waitFor(() => {
      expect(api.validerSemaine).toHaveBeenCalledWith(
        A_VALIDER[0]!.contratId,
        '2026-W27',
      );
    });
    expect(
      await screen.findByText(/validé \(avec modifications\)/i),
    ).toBeInTheDocument();
  });

  it('ouvre l’éditeur hebdomadaire consolidé depuis « Éditer la semaine »', async () => {
    vi.mocked(api.listerAValider).mockResolvedValue(A_VALIDER);
    render(<EncartValidation foyerId="foyer-1" />);

    const bouton = await screen.findByRole('button', {
      name: 'Éditer la semaine',
    });
    fireEvent.click(bouton);

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
      await screen.findByRole('heading', {
        name: /Éditer les besoins de la semaine 27/i,
      }),
    ).toBeInTheDocument();
    expect(
      await screen.findByText('Crèche Les Hirondelles'),
    ).toBeInTheDocument();
    expect(screen.getByText(/Léa — Crèche PSU/)).toBeInTheDocument();
  });
});
