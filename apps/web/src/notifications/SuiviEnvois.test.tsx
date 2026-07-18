import { render, screen, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { SuiviEnvois } from './SuiviEnvois';
import type { SuiviEnvois as SuiviEnvoisVue } from '../types/bff';

vi.mock('../api/client', () => ({
  api: { lireSuiviEnvois: vi.fn() },
  ApiError: class ApiError extends Error {},
}));

import { api } from '../api/client';

const FOYER = 'foyer-1';
const SEMAINE = '2026-W27';
const CRECHE = '99999999-9999-4999-8999-999999999991';

/** Vue de base (tout vide) surchargée par test. */
function vue(partiel: Partial<SuiviEnvoisVue>): SuiviEnvoisVue {
  return {
    foyerId: FOYER,
    semaineIso: SEMAINE,
    rappel: null,
    etablissements: [],
    ...partiel,
  };
}

function rendre(): void {
  render(<SuiviEnvois foyerId={FOYER} semaineIso={SEMAINE} />);
}

describe('SuiviEnvois', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('rappel ENVOYE : « Rappel envoyé le {date} ({n} parent(s)). »', async () => {
    vi.mocked(api.lireSuiviEnvois).mockResolvedValue(
      vue({
        rappel: {
          statut: 'ENVOYE',
          envoyeLe: '2026-06-23T06:00:00.000Z',
          erreur: null,
          parents: [
            {
              email: 'a@ex.org',
              statut: 'ENVOYE',
              envoyeLe: '2026-06-23T06:00:00.000Z',
              essais: 0,
            },
            {
              email: 'b@ex.org',
              statut: 'ENVOYE',
              envoyeLe: '2026-06-23T06:00:00.000Z',
              essais: 0,
            },
          ],
        },
      }),
    );
    rendre();
    expect(await screen.findByText(/Suivi des envois/i)).toBeInTheDocument();
    expect(
      await screen.findByText(
        /Rappel envoyé le 23\/06\/2026 à 06:00 \(2 parent\(s\)\)\./,
      ),
    ).toBeInTheDocument();
  });

  it('rappel A_ENVOYER : « envoi prévu mardi »', async () => {
    vi.mocked(api.lireSuiviEnvois).mockResolvedValue(
      vue({
        rappel: {
          statut: 'A_ENVOYER',
          envoyeLe: null,
          erreur: null,
          parents: [],
        },
      }),
    );
    rendre();
    expect(
      await screen.findByText('Rappel hebdo : envoi prévu mardi.'),
    ).toBeInTheDocument();
  });

  it('rappel ABANDONNE : invite à vérifier la semaine dans le planning', async () => {
    vi.mocked(api.lireSuiviEnvois).mockResolvedValue(
      vue({
        rappel: {
          statut: 'ABANDONNE',
          envoyeLe: null,
          erreur: null,
          parents: [],
        },
      }),
    );
    rendre();
    expect(
      await screen.findByText(/Rappel non envoyé \(fenêtre close\)\./),
    ).toBeInTheDocument();
  });

  it('établissements : un libellé exact par statut', async () => {
    vi.mocked(api.lireSuiviEnvois).mockResolvedValue(
      vue({
        etablissements: [
          {
            etablissementId: CRECHE,
            statut: 'ENVOYE',
            envoyeLe: '2026-06-23T06:05:00.000Z',
            erreur: null,
            destinataire: 'creche@ex.org',
          },
          {
            etablissementId: '99999999-9999-4999-8999-999999999992',
            statut: 'ECHEC',
            envoyeLe: null,
            erreur: 'transport indisponible',
            destinataire: 'ecole@ex.org',
          },
          {
            etablissementId: '99999999-9999-4999-8999-999999999993',
            statut: 'DRY_RUN',
            envoyeLe: '2026-06-23T06:06:00.000Z',
            erreur: null,
            destinataire: 'test@ex.org',
          },
          {
            etablissementId: '99999999-9999-4999-8999-999999999994',
            statut: 'EN_COURS',
            envoyeLe: null,
            erreur: null,
            destinataire: 'encours@ex.org',
          },
        ],
      }),
    );
    rendre();
    expect(
      await screen.findByText(
        'Récapitulatif envoyé à creche@ex.org le 23/06/2026 à 06:05.',
      ),
    ).toBeInTheDocument();
    expect(
      screen.getByText(
        'Échec de l’envoi du récapitulatif : transport indisponible.',
      ),
    ).toBeInTheDocument();
    expect(
      screen.getByText('Récapitulatif en mode test (aucun e-mail envoyé).'),
    ).toBeInTheDocument();
    expect(
      screen.getByText('Envoi du récapitulatif en cours…'),
    ).toBeInTheDocument();
  });

  it('destinataire absent : repli « l’établissement »', async () => {
    vi.mocked(api.lireSuiviEnvois).mockResolvedValue(
      vue({
        etablissements: [
          {
            etablissementId: CRECHE,
            statut: 'ENVOYE',
            envoyeLe: '2026-06-23T06:05:00.000Z',
            erreur: null,
            destinataire: null,
          },
        ],
      }),
    );
    rendre();
    expect(
      await screen.findByText(
        'Récapitulatif envoyé à l’établissement le 23/06/2026 à 06:05.',
      ),
    ).toBeInTheDocument();
  });

  it('cas vide (rappel null, aucun établissement) : le bloc ne s’affiche pas', async () => {
    vi.mocked(api.lireSuiviEnvois).mockResolvedValue(vue({}));
    const { container } = render(
      <SuiviEnvois foyerId={FOYER} semaineIso={SEMAINE} />,
    );
    await waitFor(() => {
      expect(api.lireSuiviEnvois).toHaveBeenCalled();
    });
    expect(screen.queryByText(/Suivi des envois/i)).not.toBeInTheDocument();
    expect(container.querySelector('.suivi-envois')).toBeNull();
  });

  it('erreur de lecture : ligne discrète « Suivi des envois indisponible. »', async () => {
    vi.mocked(api.lireSuiviEnvois).mockRejectedValue(new Error('réseau coupé'));
    rendre();
    expect(
      await screen.findByText('Suivi des envois indisponible.'),
    ).toBeInTheDocument();
    // Bloc secondaire : aucun bouton (pas de « Recharger »).
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
  });
});
