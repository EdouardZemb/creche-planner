import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { RelectureEnvoi } from './RelectureEnvoi';
import type { Brouillon, EnvoiResultat } from '../types/bff';

vi.mock('../api/client', () => ({
  api: {
    lireBrouillon: vi.fn(),
    envoyerRecap: vi.fn(),
  },
  ApiError: class ApiError extends Error {},
}));

import { api } from '../api/client';

const CONTRAT_ID = '55555555-0000-4000-8000-000000000000';
const SEMAINE = '2026-W27';

function brouillon(partiel: Partial<Brouillon> = {}): Brouillon {
  return {
    contratId: CONTRAT_ID,
    semaineIso: SEMAINE,
    etablissementCle: 'CRECHE_HIRONDELLES',
    etablissementLibelle: 'Crèche Les Hirondelles',
    destinataire: 'contact-creche@example.org',
    sujet: 'Planning de Léa — semaine 2026-W27 : modifications',
    corps: '<p>Bonjour</p>',
    texte: 'Bonjour\n\n- 29/06/2026 : 1 absence',
    deltaModifs: {
      jours: [{ date: '2026-06-29', avant: null, apres: {} }],
    },
    dryRun: true,
    ...partiel,
  };
}

describe('RelectureEnvoi', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('affiche le destinataire, le diff et le bandeau DRY-RUN', async () => {
    vi.mocked(api.lireBrouillon).mockResolvedValue(brouillon());
    render(<RelectureEnvoi contratId={CONTRAT_ID} semaineIso={SEMAINE} />);

    expect(
      await screen.findByText(/contact-creche@example.org/),
    ).toBeInTheDocument();
    expect(screen.getByText(/DRY-RUN actif/)).toBeInTheDocument();
    expect(screen.getByText(/29\/06\/2026 — modifiée/)).toBeInTheDocument();
  });

  it('désactive « Envoyer » tant que le brouillon n’est pas chargé', async () => {
    let resoudre: (b: Brouillon) => void = () => undefined;
    vi.mocked(api.lireBrouillon).mockReturnValue(
      new Promise<Brouillon>((r) => {
        resoudre = r;
      }),
    );
    render(<RelectureEnvoi contratId={CONTRAT_ID} semaineIso={SEMAINE} />);

    const bouton = screen.getByRole('button', { name: /Envoyer au service/ });
    expect(bouton).toBeDisabled();

    resoudre(brouillon());
    await waitFor(() => {
      expect(bouton).toBeEnabled();
    });
  });

  it('demande confirmation puis envoie (dry-run) et affiche le résultat', async () => {
    vi.mocked(api.lireBrouillon).mockResolvedValue(brouillon());
    const resultat: EnvoiResultat = {
      contratId: CONTRAT_ID,
      semaineIso: SEMAINE,
      etablissementCle: 'CRECHE_HIRONDELLES',
      destinataire: 'contact-creche@example.org',
      statut: 'DRY_RUN',
      messageId: null,
      erreur: null,
      envoyeLe: '2026-06-29T08:00:00.000Z',
    };
    vi.mocked(api.envoyerRecap).mockResolvedValue(resultat);

    render(<RelectureEnvoi contratId={CONTRAT_ID} semaineIso={SEMAINE} />);
    const bouton = await screen.findByRole('button', {
      name: /Envoyer au service/,
    });
    fireEvent.click(bouton);

    // Confirmation explicite avant l'action sortante.
    const confirmer = await screen.findByRole('button', {
      name: /Envoyer \(dry-run\)/,
    });
    fireEvent.click(confirmer);

    await waitFor(() => {
      expect(api.envoyerRecap).toHaveBeenCalledWith(CONTRAT_ID, SEMAINE);
    });
    expect(await screen.findByText(/mode dry-run/i)).toBeInTheDocument();
  });

  it('avertit d’une action irréversible quand l’envoi serait réel', async () => {
    vi.mocked(api.lireBrouillon).mockResolvedValue(
      brouillon({ dryRun: false }),
    );
    render(<RelectureEnvoi contratId={CONTRAT_ID} semaineIso={SEMAINE} />);

    const bouton = await screen.findByRole('button', {
      name: /Envoyer au service/,
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
    vi.mocked(api.lireBrouillon).mockResolvedValue(brouillon());
    vi.mocked(api.envoyerRecap).mockResolvedValue({
      contratId: CONTRAT_ID,
      semaineIso: SEMAINE,
      etablissementCle: 'CRECHE_HIRONDELLES',
      destinataire: 'contact-creche@example.org',
      statut: 'ECHEC',
      messageId: null,
      erreur: 'SMTP 535 auth refusée',
      envoyeLe: '2026-06-29T08:00:00.000Z',
    });

    render(<RelectureEnvoi contratId={CONTRAT_ID} semaineIso={SEMAINE} />);
    fireEvent.click(
      await screen.findByRole('button', { name: /Envoyer au service/ }),
    );
    fireEvent.click(
      await screen.findByRole('button', { name: /Envoyer \(dry-run\)/ }),
    );

    expect(await screen.findByText(/SMTP 535/)).toBeInTheDocument();
  });
});
