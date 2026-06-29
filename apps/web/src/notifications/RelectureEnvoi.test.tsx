import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { RelectureEnvoi } from './RelectureEnvoi';
import type {
  BrouillonEtablissement,
  EnvoiEtablissementResultat,
  SemaineBesoins,
} from '../types/bff';

vi.mock('../api/client', () => ({
  api: {
    lireSemaineBesoins: vi.fn(),
    lireBrouillonEtablissement: vi.fn(),
    envoyerRecapEtablissement: vi.fn(),
  },
  ApiError: class ApiError extends Error {},
}));

import { api } from '../api/client';

const FOYER_ID = 'foyer-1';
const SEMAINE = '2026-W27';
// Établissements réels du foyer (read model `etablissement`, entité libre).
const CRECHE_ID = '99999999-9999-4999-8999-999999999991';
const ABCM_ID = '99999999-9999-4999-8999-999999999992';

/**
 * Vue `semaine/besoins` réduite : deux établissements concernés (crèche + ABCM). Le
 * détail des contrats/besoins n'est pas lu par `RelectureEnvoi` (seule la liste des
 * établissements concernés l'est), on fournit donc le strict nécessaire.
 */
function semaineBesoins(): SemaineBesoins {
  return {
    semaineIso: SEMAINE,
    jours: [],
    etablissements: [
      {
        etablissementId: CRECHE_ID,
        libelle: 'Crèche Les Hirondelles',
        preavisRegle: null,
      },
      { etablissementId: ABCM_ID, libelle: 'École ABCM', preavisRegle: null },
    ],
    contrats: [],
  };
}

/** Brouillon agrégé : la crèche est concernée, l'ABCM ne l'est pas (enfants vide). */
function brouillonPour(
  etablissementId: string,
  partiel: Partial<BrouillonEtablissement> = {},
): BrouillonEtablissement {
  const concerne = etablissementId === CRECHE_ID;
  return {
    foyerId: FOYER_ID,
    semaineIso: SEMAINE,
    etablissementId,
    etablissementLibelle: concerne ? 'Crèche Les Hirondelles' : 'École ABCM',
    destinataire: concerne
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
  override: (id: string) => BrouillonEtablissement = brouillonPour,
) {
  vi.mocked(api.lireSemaineBesoins).mockResolvedValue(semaineBesoins());
  vi.mocked(api.lireBrouillonEtablissement).mockImplementation(
    (_foyerId, _semaineIso, etablissementId) =>
      Promise.resolve(override(etablissementId)),
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
    mockBrouillons((id) => brouillonPour(id, { enfants: [] }));
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
      etablissementId: CRECHE_ID,
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
        CRECHE_ID,
      );
    });
    expect(await screen.findByText(/mode dry-run/i)).toBeInTheDocument();
  });

  it('avertit d’une action irréversible quand l’envoi serait réel', async () => {
    mockBrouillons((id) => brouillonPour(id, { dryRun: false }));
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
      etablissementId: CRECHE_ID,
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
