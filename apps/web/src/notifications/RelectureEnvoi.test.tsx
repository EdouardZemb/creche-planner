import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
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
    sujet: 'Plannings modifiés — semaine du 29 juin au 5 juillet 2026',
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
    routable: true,
    raisonNonRoutable: null,
    dryRun: true,
    ...partiel,
  };
}

/** `RelectureEnvoi` rend un `<Link>` (crèche sans e-mail) → contexte Router requis. */
function renderRelecture() {
  return render(
    <MemoryRouter>
      <RelectureEnvoi foyerId={FOYER_ID} semaineIso={SEMAINE} />
    </MemoryRouter>,
  );
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
    renderRelecture();

    // La crèche est concernée → bloc + enfant Léa + bandeau « Mode test » (dry-run).
    expect(
      await screen.findByText(/contact-creche@example.org/),
    ).toBeInTheDocument();
    expect(screen.getByText(/Mode test/)).toBeInTheDocument();
    expect(screen.getByText('Léa')).toBeInTheDocument();
    // L'ABCM n'a aucun enfant concerné → pas de bloc pour lui.
    expect(
      screen.queryByText(/contact-abcm@example.org/),
    ).not.toBeInTheDocument();
  });

  it('nomme chaque jour du delta en langage parent (date longue + nature)', async () => {
    // Seule la crèche porte les jours (l'ABCM reste sans enfant → un seul bloc rendu,
    // donc chaque libellé de jour n'apparaît qu'une fois).
    mockBrouillons((id) =>
      id === CRECHE_ID
        ? brouillonPour(id, {
            enfants: [
              {
                contratId: 'c-lea',
                enfant: 'Léa',
                deltaModifs: {
                  jours: [
                    { date: '2026-06-29', avant: null, apres: {} }, // lundi — modifiée
                    { date: '2026-06-30', avant: {}, apres: null }, // mardi — retirée
                    {
                      date: '2026-07-01', // mercredi — ajustement d'heures réelles
                      avant: null,
                      apres: { ajustements: [{ date: '2026-07-01' }] },
                    },
                  ],
                },
              },
            ],
          })
        : brouillonPour(id),
    );
    renderRelecture();

    // Dates longues (« mardi 1 juillet ») plutôt que « 2026-W27 » ou « 01/07/2026 ».
    expect(
      await screen.findByText('lundi 29 juin — modifiée'),
    ).toBeInTheDocument();
    expect(
      screen.getByText('mardi 30 juin — journée retirée'),
    ).toBeInTheDocument();
    expect(
      screen.getByText('mercredi 1 juillet — horaires ajustés'),
    ).toBeInTheDocument();
  });

  it('indique l’absence de modification quand aucun établissement n’est concerné', async () => {
    mockBrouillons((id) => brouillonPour(id, { enfants: [] }));
    renderRelecture();

    expect(
      await screen.findByText(/Aucune modification à transmettre/i),
    ).toBeInTheDocument();
  });

  it('signale une crèche NON routable (sans e-mail) au lieu de l’écarter en silence', async () => {
    // La crèche est concernée (enfants) mais sans e-mail : brouillon non routable.
    mockBrouillons((id) =>
      id === CRECHE_ID
        ? brouillonPour(id, {
            routable: false,
            raisonNonRoutable: 'SANS_EMAIL',
            destinataire: '',
            dryRun: false,
          })
        : brouillonPour(id),
    );
    renderRelecture();

    // Avertissement explicite (jamais « rien à transmettre » à tort). Apostrophe
    // typographique ou droite tolérée (le rendu utilise « ’ »).
    expect(
      await screen.findByText(/n['’]a pas d['’]e-mail/i),
    ).toBeInTheDocument();
    expect(
      screen.queryByText(/Aucune modification à transmettre/i),
    ).not.toBeInTheDocument();
    // Les enfants concernés restent listés (le parent voit ce qui n'est PAS transmis).
    expect(screen.getByText('Léa')).toBeInTheDocument();
    // Aucun bouton d'envoi pour une crèche non joignable.
    expect(
      screen.queryByRole('button', { name: /Envoyer le récapitulatif/ }),
    ).not.toBeInTheDocument();
    // Raccourci « Ajouter un e-mail » vers l'écran des crèches du foyer.
    const lien = screen.getByRole('link', { name: /Ajouter un e-mail/ });
    expect(lien).toHaveAttribute('href', `/foyers/${FOYER_ID}/etablissements`);
  });

  it('signale une crèche ARCHIVÉE (réactivable) au lieu de l’écarter en silence', async () => {
    // La crèche est concernée (enfants) mais archivée : brouillon non routable, raison
    // ARCHIVE (même si elle a un e-mail — l'archivage prime côté service).
    mockBrouillons((id) =>
      id === CRECHE_ID
        ? brouillonPour(id, {
            routable: false,
            raisonNonRoutable: 'ARCHIVE',
            destinataire: '',
            dryRun: false,
          })
        : brouillonPour(id),
    );
    renderRelecture();

    // Message dédié « archivée : réactivez-la… » (distinct du cas sans e-mail).
    expect(
      await screen.findByText(/est archivée : réactivez-la/i),
    ).toBeInTheDocument();
    expect(
      screen.queryByText(/Aucune modification à transmettre/i),
    ).not.toBeInTheDocument();
    // Les enfants concernés restent listés (le parent voit ce qui n'est PAS transmis).
    expect(screen.getByText('Léa')).toBeInTheDocument();
    // Aucun bouton d'envoi pour une crèche non joignable.
    expect(
      screen.queryByRole('button', { name: /Envoyer le récapitulatif/ }),
    ).not.toBeInTheDocument();
    // Raccourci « Réactiver » vers l'écran des crèches du foyer.
    const lien = screen.getByRole('link', { name: /Réactiver/ });
    expect(lien).toHaveAttribute('href', `/foyers/${FOYER_ID}/etablissements`);
  });

  it('demande confirmation puis envoie (mode test) le récap de l’établissement', async () => {
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

    renderRelecture();
    const bouton = await screen.findByRole('button', {
      name: /Envoyer le récapitulatif à Crèche Les Hirondelles/,
    });
    fireEvent.click(bouton);

    // Confirmation explicite avant l'action sortante.
    const confirmer = await screen.findByRole('button', {
      name: /Envoyer \(mode test\)/,
    });
    fireEvent.click(confirmer);

    await waitFor(() => {
      expect(api.envoyerRecapEtablissement).toHaveBeenCalledWith(
        FOYER_ID,
        SEMAINE,
        CRECHE_ID,
      );
    });
    // Message de résultat (distinct du bandeau « Mode test » toujours affiché).
    expect(
      await screen.findByText(
        /Test réussi : aucun mail n'a vraiment été envoyé/i,
      ),
    ).toBeInTheDocument();
  });

  it('avertit d’une action irréversible quand l’envoi serait réel', async () => {
    mockBrouillons((id) => brouillonPour(id, { dryRun: false }));
    renderRelecture();

    const bouton = await screen.findByRole('button', {
      name: /Envoyer le récapitulatif à Crèche Les Hirondelles/,
    });
    expect(screen.queryByText(/Mode test/)).not.toBeInTheDocument();
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

    renderRelecture();
    fireEvent.click(
      await screen.findByRole('button', {
        name: /Envoyer le récapitulatif à Crèche Les Hirondelles/,
      }),
    );
    fireEvent.click(
      await screen.findByRole('button', { name: /Envoyer \(mode test\)/ }),
    );

    // L'échec est une alerte (rouge), pas un statut discret.
    const alerte = await screen.findByRole('alert');
    expect(alerte).toHaveTextContent(/SMTP 535/);
    expect(alerte).toHaveClass('debit');
    // Le bouton ne se fige pas sur « Envoyé » : il propose de réessayer.
    const bouton = screen.getByRole('button', {
      name: /Envoyer le récapitulatif à Crèche Les Hirondelles/,
    });
    expect(bouton).not.toBeDisabled();
    expect(bouton).toHaveTextContent(/Réessayer l'envoi/);
  });

  it('prend le focus à l’apparition pour guider vers la dernière étape', async () => {
    mockBrouillons();
    renderRelecture();

    const section = await screen.findByRole('region', {
      name: /Dernière étape : prévenir les services/i,
    });
    expect(section).toHaveFocus();
  });
});
