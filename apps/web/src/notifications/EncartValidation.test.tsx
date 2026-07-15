import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
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

// Établissement réel concerné (read model `etablissement`, entité libre par foyer).
const ID_CRECHE = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';

/** Brouillon agrégé renvoyé à la `RelectureEnvoi` montée après une validation. */
function brouillonPour(etablissementId: string) {
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
    enfants: concerne
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
    routable: true,
    raisonNonRoutable: null,
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

/** Deux contrats du même foyer pour la **même semaine** (enrichis enfant + mode). */
const A_VALIDER_DEUX: NotificationAValider[] = [
  {
    contratId: 'c-zoe',
    foyerId: 'foyer-1',
    semaineIso: '2026-W28',
    statut: 'A_VALIDER',
    notifieeLe: '2026-06-23T06:00:00.000Z',
    enfant: 'Zoé',
    mode: 'CRECHE_PSU',
  },
  {
    contratId: 'c-mia',
    foyerId: 'foyer-1',
    semaineIso: '2026-W28',
    statut: 'A_VALIDER',
    notifieeLe: '2026-06-23T06:00:00.000Z',
    enfant: 'Mia',
    mode: 'CANTINE',
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
      etablissementId: ID_CRECHE,
      libelle: 'Crèche Les Hirondelles',
      preavisRegle: { type: 'JOURS_OUVRES' as const, valeur: 2 },
    },
  ],
  contrats: [
    {
      contratId: '55555555-0000-4000-8000-000000000000',
      enfant: 'Léa',
      mode: 'CRECHE_PSU' as const,
      etablissementId: ID_CRECHE,
      besoins: {},
    },
  ],
};

describe('EncartValidation', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(api.lireBrouillonEtablissement).mockImplementation(
      (_foyerId, _semaineIso, etablissementId) =>
        Promise.resolve(brouillonPour(etablissementId)),
    );
    vi.mocked(api.lireSemaineBesoins).mockResolvedValue(SEMAINE_BESOINS);
  });

  it('affiche un placeholder pendant la vérification puis rien s’il n’y a rien à valider', async () => {
    vi.mocked(api.listerAValider).mockResolvedValue([]);
    const { container } = render(<EncartValidation foyerId="foyer-1" />, {
      wrapper: MemoryRouter,
    });

    // Pendant le chargement : l'encart est visible avec un placeholder explicite
    // (avant : invisible → impossible de distinguer « rien à valider » de « pas
    // encore vérifié », et l'encart faisait sauter la page en apparaissant).
    expect(
      screen.getByText(/Vérification des semaines à valider/i),
    ).toBeInTheDocument();
    expect(container.querySelector('section')).toHaveAttribute(
      'aria-busy',
      'true',
    );

    // Liste (vide) chargée : cas nominal, l'encart disparaît complètement.
    await waitFor(() => {
      expect(container.querySelector('section')).toBeNull();
    });
    expect(api.listerAValider).toHaveBeenCalledWith('foyer-1', {
      signal: expect.anything(),
    });
    expect(
      screen.queryByText(/Valider la semaine suivante/i),
    ).not.toBeInTheDocument();
  });

  it('liste les semaines à valider avec un libellé lisible', async () => {
    vi.mocked(api.listerAValider).mockResolvedValue(A_VALIDER);
    render(<EncartValidation foyerId="foyer-1" />, { wrapper: MemoryRouter });

    expect(
      await screen.findByText(/Valider la semaine suivante/i),
    ).toBeInTheDocument();
    // Dates réelles, jamais le numéro de semaine ISO (UX lot 2 « parler parent »).
    expect(
      screen.getByText(/Planning de la semaine du 29 juin au 5 juillet/),
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

    render(<EncartValidation foyerId="foyer-1" />, { wrapper: MemoryRouter });
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
    // La bifurcation est nommée : le message annonce la dernière étape et la
    // section de relecture/envoi apparaît (le parent ne peut pas la manquer).
    expect(
      screen.getByText(/Dernière étape : prévenir le service ci-dessous/i),
    ).toBeInTheDocument();
    expect(
      await screen.findByRole('heading', {
        name: /Dernière étape : prévenir les services/i,
      }),
    ).toBeInTheDocument();
  });

  it('reste affiché avec la confirmation quand la dernière semaine est validée', async () => {
    // Première lecture : une semaine à valider ; relecture après validation : plus rien.
    vi.mocked(api.listerAValider)
      .mockResolvedValueOnce(A_VALIDER)
      .mockResolvedValue([]);
    vi.mocked(api.validerSemaine).mockResolvedValue({
      contratId: A_VALIDER[0]!.contratId,
      semaineIso: '2026-W27',
      statut: 'VALIDEE',
      deltaModifs: null,
    });

    render(<EncartValidation foyerId="foyer-1" />, { wrapper: MemoryRouter });
    fireEvent.click(await screen.findByRole('button', { name: 'Valider' }));

    // L'encart ne disparaît PAS : la confirmation reste lisible et l'état final
    // est explicite (avant : tout s'évanouissait, confirmation comprise).
    expect(await screen.findByText(/validé\./i)).toBeInTheDocument();
    expect(
      await screen.findByText(/Plus rien à valider pour le moment/i),
    ).toBeInTheDocument();
    expect(
      screen.getByText(/Valider la semaine suivante/i),
    ).toBeInTheDocument();
  });

  it('affiche l’échec en alerte et permet de réessayer', async () => {
    vi.mocked(api.listerAValider).mockResolvedValue(A_VALIDER);
    vi.mocked(api.validerSemaine)
      .mockRejectedValueOnce(new Error('réseau coupé'))
      .mockResolvedValue({
        contratId: A_VALIDER[0]!.contratId,
        semaineIso: '2026-W27',
        statut: 'VALIDEE',
        deltaModifs: null,
      });

    render(<EncartValidation foyerId="foyer-1" />, { wrapper: MemoryRouter });
    fireEvent.click(await screen.findByRole('button', { name: 'Valider' }));

    // L'échec est annoncé comme une alerte (rouge), pas comme un succès.
    const alerte = await screen.findByRole('alert');
    expect(alerte).toHaveTextContent(/réseau coupé/i);
    expect(alerte).toHaveClass('debit');

    // « Réessayer » relance la même validation, sans re-chercher la ligne.
    fireEvent.click(screen.getByRole('button', { name: 'Réessayer' }));
    expect(await screen.findByText(/validé\./i)).toBeInTheDocument();
    expect(api.validerSemaine).toHaveBeenCalledTimes(2);
  });

  it('distingue chaque ligne par enfant + mode quand plusieurs contrats partagent la semaine', async () => {
    vi.mocked(api.listerAValider).mockResolvedValue(A_VALIDER_DEUX);
    render(<EncartValidation foyerId="foyer-1" />, { wrapper: MemoryRouter });

    // Chaque ligne identifie sans ambiguïté l'enfant et le mode (pas deux libellés
    // identiques « Planning de la semaine 28 »).
    expect(
      await screen.findByText(/Zoé — Crèche · semaine du 6 au 12 juillet/),
    ).toBeInTheDocument();
    expect(
      screen.getByText(/Mia — Cantine · semaine du 6 au 12 juillet/),
    ).toBeInTheDocument();
    // Boutons « Valider » ciblés par aria-label distinct (a11y).
    expect(
      screen.getByRole('button', {
        name: 'Valider la semaine du 6 au 12 juillet — Zoé, Crèche',
      }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole('button', {
        name: 'Valider la semaine du 6 au 12 juillet — Mia, Cantine',
      }),
    ).toBeInTheDocument();
  });

  it('valider un contrat ne désactive que SON bouton (indexation par contrat)', async () => {
    vi.mocked(api.listerAValider).mockResolvedValue(A_VALIDER_DEUX);
    // Validation de Zoé suspendue : on observe l'état « en cours » sans le résoudre.
    let resoudre!: (v: ValidationResultat) => void;
    vi.mocked(api.validerSemaine).mockReturnValue(
      new Promise<ValidationResultat>((r) => {
        resoudre = r;
      }),
    );
    render(<EncartValidation foyerId="foyer-1" />, { wrapper: MemoryRouter });

    const validerZoe = await screen.findByRole('button', {
      name: 'Valider la semaine du 6 au 12 juillet — Zoé, Crèche',
    });
    const validerMia = screen.getByRole('button', {
      name: 'Valider la semaine du 6 au 12 juillet — Mia, Cantine',
    });
    fireEvent.click(validerZoe);

    // Le bouton de Zoé passe « en cours » (désactivé) ; celui de Mia reste actif.
    await waitFor(() => {
      expect(validerZoe).toBeDisabled();
    });
    expect(validerMia).not.toBeDisabled();

    resoudre({
      contratId: 'c-zoe',
      semaineIso: '2026-W28',
      statut: 'VALIDEE',
      deltaModifs: null,
    });
    // Le message nomme l'enfant validé.
    expect(
      await screen.findByText(/Zoé — semaine du 6 au 12 juillet validé/),
    ).toBeInTheDocument();
  });

  it('ouvre l’éditeur hebdomadaire consolidé depuis « Éditer la semaine »', async () => {
    vi.mocked(api.listerAValider).mockResolvedValue(A_VALIDER);
    render(<EncartValidation foyerId="foyer-1" />, { wrapper: MemoryRouter });

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
        name: /Éditer les besoins de la semaine du 29 juin au 5 juillet/i,
      }),
    ).toBeInTheDocument();
    expect(
      await screen.findByText('Crèche Les Hirondelles'),
    ).toBeInTheDocument();
    expect(screen.getByText(/Léa — Crèche/)).toBeInTheDocument();
  });

  it('semaineInitiale (lien profond) : ouvre l’éditeur d’office sans clic', async () => {
    vi.mocked(api.listerAValider).mockResolvedValue(A_VALIDER);
    render(<EncartValidation foyerId="foyer-1" semaineInitiale="2026-W27" />, {
      wrapper: MemoryRouter,
    });

    // L'éditeur s'ouvre seul dès que la semaine ciblée apparaît dans la liste : le
    // parent arrive directement sur l'éditeur (aucun bouton « Éditer » cliqué).
    expect(
      await screen.findByRole('heading', {
        name: /Éditer les besoins de la semaine du 29 juin au 5 juillet/i,
      }),
    ).toBeInTheDocument();
    await waitFor(() => {
      expect(api.lireSemaineBesoins).toHaveBeenCalledWith(
        'foyer-1',
        '2026-W27',
        { signal: expect.anything() },
      );
    });
  });

  it('semaineInitiale absente de la liste : ignorée sans erreur (éditeur fermé)', async () => {
    vi.mocked(api.listerAValider).mockResolvedValue(A_VALIDER);
    render(<EncartValidation foyerId="foyer-1" semaineInitiale="2026-W40" />, {
      wrapper: MemoryRouter,
    });

    // La liste s'affiche normalement…
    expect(
      await screen.findByText(/Planning de la semaine du 29 juin au 5 juillet/),
    ).toBeInTheDocument();
    // …mais l'éditeur ne s'ouvre pas (semaine non concernée / déjà validée).
    expect(
      screen.queryByRole('heading', { name: /Éditer les besoins/i }),
    ).not.toBeInTheDocument();
    expect(api.lireSemaineBesoins).not.toHaveBeenCalled();
  });
});
