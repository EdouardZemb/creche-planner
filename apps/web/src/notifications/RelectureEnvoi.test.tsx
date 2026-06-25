import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { RelectureEnvoi } from './RelectureEnvoi';
import type {
  BrouillonEtablissement,
  EnvoiEtablissementResultat,
} from '../types/bff';

vi.mock('../api/client', () => ({
  api: {
    lireBrouillonEtablissement: vi.fn(),
    envoyerRecapEtablissement: vi.fn(),
  },
  ApiError: class ApiError extends Error {},
}));

import { api } from '../api/client';

const FOYER_ID = 'foyer-1';
const SEMAINE = '2026-W27';

/** Brouillon agrégé : la crèche est concernée, l'ABCM ne l'est pas (enfants vide). */
function brouillonPour(
  cle: string,
  partiel: Partial<BrouillonEtablissement> = {},
): BrouillonEtablissement {
  const concerne = cle === 'CRECHE_HIRONDELLES';
  return {
    foyerId: FOYER_ID,
    semaineIso: SEMAINE,
    etablissementCle: cle as BrouillonEtablissement['etablissementCle'],
    etablissementLibelle:
      cle === 'CRECHE_HIRONDELLES' ? 'Crèche Les Hirondelles' : 'École ABCM',
    destinataire:
      cle === 'CRECHE_HIRONDELLES'
        ? 'contact-creche@example.org'
        : 'contact-abcm@example.org',
    sujet: 'Plannings modifiés — semaine 2026-W27',
    corps: '<p>Bonjour</p>',
    texte: 'Bonjour\n\nLéa :\n- 29/06/2026 : 1 absence',
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
    ...partiel,
  };
}

function mockBrouillons(
  override: (cle: string) => BrouillonEtablissement = brouillonPour,
) {
  vi.mocked(api.lireBrouillonEtablissement).mockImplementation(
    (_foyerId, _semaineIso, cle) => Promise.resolve(override(cle)),
  );
}

describe('RelectureEnvoi (agrégé par établissement)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('n’affiche un bloc que pour les établissements concernés', async () => {
    mockBrouillons();
    render(<RelectureEnvoi foyerId={FOYER_ID} semaineIso={SEMAINE} />);

    // La crèche est concernée → bloc + enfant Léa + bandeau DRY-RUN.
    expect(
      await screen.findByText(/contact-creche@example.org/),
    ).toBeInTheDocument();
    expect(screen.getByText(/DRY-RUN actif/)).toBeInTheDocument();
    expect(screen.getByText('Léa')).toBeInTheDocument();
    // L'ABCM n'a aucun enfant concerné → pas de bloc pour lui.
    expect(
      screen.queryByText(/contact-abcm@example.org/),
    ).not.toBeInTheDocument();
  });

  it('indique l’absence de modification quand aucun établissement n’est concerné', async () => {
    mockBrouillons((cle) => brouillonPour(cle, { enfants: [] }));
    render(<RelectureEnvoi foyerId={FOYER_ID} semaineIso={SEMAINE} />);

    expect(
      await screen.findByText(/Aucune modification à transmettre/i),
    ).toBeInTheDocument();
  });

  it('demande confirmation puis envoie (dry-run) le récap de l’établissement', async () => {
    mockBrouillons();
    const resultat: EnvoiEtablissementResultat = {
      foyerId: FOYER_ID,
      semaineIso: SEMAINE,
      etablissementCle: 'CRECHE_HIRONDELLES',
      destinataire: 'contact-creche@example.org',
      statut: 'DRY_RUN',
      messageId: null,
      erreur: null,
      envoyeLe: '2026-06-29T08:00:00.000Z',
    };
    vi.mocked(api.envoyerRecapEtablissement).mockResolvedValue(resultat);

    render(<RelectureEnvoi foyerId={FOYER_ID} semaineIso={SEMAINE} />);
    const bouton = await screen.findByRole('button', {
      name: /Envoyer le récapitulatif à Crèche Les Hirondelles/,
    });
    fireEvent.click(bouton);

    // Confirmation explicite avant l'action sortante.
    const confirmer = await screen.findByRole('button', {
      name: /Envoyer \(dry-run\)/,
    });
    fireEvent.click(confirmer);

    await waitFor(() => {
      expect(api.envoyerRecapEtablissement).toHaveBeenCalledWith(
        FOYER_ID,
        SEMAINE,
        'CRECHE_HIRONDELLES',
      );
    });
    expect(await screen.findByText(/mode dry-run/i)).toBeInTheDocument();
  });

  it('avertit d’une action irréversible quand l’envoi serait réel', async () => {
    mockBrouillons((cle) => brouillonPour(cle, { dryRun: false }));
    render(<RelectureEnvoi foyerId={FOYER_ID} semaineIso={SEMAINE} />);

    const bouton = await screen.findByRole('button', {
      name: /Envoyer le récapitulatif à Crèche Les Hirondelles/,
    });
    expect(screen.queryByText(/DRY-RUN actif/)).not.toBeInTheDocument();
    fireEvent.click(bouton);

    expect(
      await screen.findByText(/action est irréversible/i),
    ).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: /Envoyer le mail/ }),
    ).toBeInTheDocument();
  });

  it('signale l’échec de l’envoi', async () => {
    mockBrouillons();
    vi.mocked(api.envoyerRecapEtablissement).mockResolvedValue({
      foyerId: FOYER_ID,
      semaineIso: SEMAINE,
      etablissementCle: 'CRECHE_HIRONDELLES',
      destinataire: 'contact-creche@example.org',
      statut: 'ECHEC',
      messageId: null,
      erreur: 'SMTP 535 auth refusée',
      envoyeLe: '2026-06-29T08:00:00.000Z',
    });

    render(<RelectureEnvoi foyerId={FOYER_ID} semaineIso={SEMAINE} />);
    fireEvent.click(
      await screen.findByRole('button', {
        name: /Envoyer le récapitulatif à Crèche Les Hirondelles/,
      }),
    );
    fireEvent.click(
      await screen.findByRole('button', { name: /Envoyer \(dry-run\)/ }),
    );

    expect(await screen.findByText(/SMTP 535/)).toBeInTheDocument();
  });
});
