import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { EditeurContratSemaine } from './EditeurContratSemaine';
import type { ContratBesoinsSemaine, ValidationResultat } from '../types/bff';

vi.mock('../api/client', () => ({
  api: {
    ecrireSemaineBesoins: vi.fn(),
    validerSemaine: vi.fn(),
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

import { api, ApiError } from '../api/client';

const SEMAINE = '2026-W27';
const JOURS = [
  '2026-06-29',
  '2026-06-30',
  '2026-07-01',
  '2026-07-02',
  '2026-07-03',
  '2026-07-04',
  '2026-07-05',
];

/** Contrat crèche : une absence datée le lundi, gardée le mardi (semaine-type). */
function contratCreche(): ContratBesoinsSemaine {
  return {
    contratId: 'c-lea',
    enfant: 'Léa',
    mode: 'CRECHE_PSU',
    etablissementId: null,
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
        exceptions: [],
        joursAlsh: [],
      },
    },
  };
}

function rendre(
  contrat: ContratBesoinsSemaine,
  props?: {
    onEnregistre?: () => void;
    onValide?: (s: ValidationResultat['statut']) => void;
  },
) {
  return render(
    <EditeurContratSemaine
      contrat={contrat}
      jours={JOURS}
      semaineIso={SEMAINE}
      {...props}
    />,
  );
}

/** Attend l'écriture debouncée (800 ms) et rend son corps. */
async function corpsEcrit() {
  await waitFor(
    () => {
      expect(api.ecrireSemaineBesoins).toHaveBeenCalled();
    },
    { timeout: 2000 },
  );
  const [contratId, semaine, corps] = vi.mocked(api.ecrireSemaineBesoins).mock
    .calls[0]!;
  return { contratId, semaine, corps };
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(api.ecrireSemaineBesoins).mockResolvedValue(undefined);
});

describe('EditeurContratSemaine (crèche PSU)', () => {
  it('initialise les besoins depuis le contrat : absence datée, semaine-type, jours vides', () => {
    rendre(contratCreche());

    expect(screen.getByText('Léa — Crèche')).toBeInTheDocument();
    // Lundi : absence datée → résumé + bouton « Modifier ».
    expect(screen.getByText('Absent (09:00–16:30)')).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: 'Modifier le Lundi 29/06/2026' }),
    ).toBeInTheDocument();
    // Mardi : pas d'entrée datée → repli sur la semaine-type, bouton « Saisir ».
    expect(screen.getByText('Gardé 08:00–17:00')).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: 'Saisir le Mardi 30/06/2026' }),
    ).toBeInTheDocument();
    // Mercredi → dimanche : ni entrée datée ni base → « — ».
    expect(screen.getAllByText('—')).toHaveLength(5);
  });

  it('saisit un jour ajouté avec ses horaires et écrit la semaine (debounce)', async () => {
    const user = userEvent.setup();
    const onEnregistre = vi.fn();
    rendre(contratCreche(), { onEnregistre });

    await user.click(
      screen.getByRole('button', { name: 'Saisir le Mercredi 01/07/2026' }),
    );
    await user.click(screen.getByLabelText('Jour ajouté'));
    fireEvent.change(screen.getByLabelText(/Heure d’arrivée/), {
      target: { value: '08:30' },
    });
    fireEvent.change(screen.getByLabelText(/Heure de départ/), {
      target: { value: '17:30' },
    });
    await user.click(screen.getByRole('button', { name: 'Confirmer' }));

    // Le résumé du jour reflète la saisie sans attendre l'écriture.
    expect(screen.getByText('Jour ajouté (08:30–17:30)')).toBeInTheDocument();

    const { contratId, semaine, corps } = await corpsEcrit();
    expect(contratId).toBe('c-lea');
    expect(semaine).toBe(SEMAINE);
    expect(corps.joursSupplementaires).toEqual([
      {
        date: '2026-07-01',
        debutHeures: 8,
        debutMinutes: 30,
        finHeures: 17,
        finMinutes: 30,
      },
    ]);
    // L'absence du lundi est conservée dans le corps (semaine complète).
    expect(corps.absences).toEqual([
      expect.objectContaining({ date: '2026-06-29' }),
    ]);
    await waitFor(() => {
      expect(onEnregistre).toHaveBeenCalled();
    });
    expect(await screen.findByText('Enregistré')).toBeInTheDocument();
  });

  it('préremplit la modale depuis l’absence existante et enregistre ses modifications', async () => {
    const user = userEvent.setup();
    rendre(contratCreche());

    await user.click(
      screen.getByRole('button', { name: 'Modifier le Lundi 29/06/2026' }),
    );

    // Champs préremplis depuis l'absence datée du contrat.
    expect(screen.getByLabelText('Absence')).toBeChecked();
    expect(screen.getByLabelText(/Heure d’arrivée/)).toHaveValue('09:00');
    expect(screen.getByLabelText(/Heure de départ/)).toHaveValue('16:30');

    fireEvent.change(screen.getByLabelText(/Signalée combien de jours/), {
      target: { value: '2' },
    });
    await user.click(screen.getByLabelText('Certificat médical'));
    await user.click(screen.getByRole('button', { name: 'Confirmer' }));

    const { corps } = await corpsEcrit();
    expect(corps.absences).toEqual([
      {
        date: '2026-06-29',
        debutHeures: 9,
        debutMinutes: 0,
        finHeures: 16,
        finMinutes: 30,
        preavisJours: 2,
        certificatMaladie: true,
      },
    ]);
  });

  it('refuse une plage invalide : message et confirmation désactivée', async () => {
    const user = userEvent.setup();
    rendre(contratCreche());

    await user.click(
      screen.getByRole('button', { name: 'Saisir le Mercredi 01/07/2026' }),
    );
    // Départ avant l'arrivée par défaut (09:00).
    fireEvent.change(screen.getByLabelText(/Heure de départ/), {
      target: { value: '08:00' },
    });

    expect(
      screen.getByText('L’heure de départ doit être postérieure à l’arrivée.'),
    ).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Confirmer' })).toBeDisabled();
    expect(api.ecrireSemaineBesoins).not.toHaveBeenCalled();
  });

  it('supprime la saisie d’un jour (corps vidé de l’absence)', async () => {
    const user = userEvent.setup();
    rendre(contratCreche());

    await user.click(
      screen.getByRole('button', { name: 'Modifier le Lundi 29/06/2026' }),
    );
    await user.click(screen.getByRole('button', { name: 'Supprimer' }));

    const { corps } = await corpsEcrit();
    // Plus aucune catégorie datée : le corps est vide.
    expect(corps).toEqual({});
    // La rangée du lundi retombe sur « — » (pas de semaine-type ce jour-là).
    expect(
      screen.getByRole('button', { name: 'Saisir le Lundi 29/06/2026' }),
    ).toBeInTheDocument();
  });

  it('affiche l’erreur d’enregistrement quand l’écriture échoue', async () => {
    const user = userEvent.setup();
    vi.mocked(api.ecrireSemaineBesoins).mockRejectedValue(
      new ApiError(502, undefined),
    );
    rendre(contratCreche());

    await user.click(
      screen.getByRole('button', { name: 'Modifier le Lundi 29/06/2026' }),
    );
    await user.click(screen.getByRole('button', { name: 'Supprimer' }));

    expect(
      await screen.findByText("Erreur d'enregistrement", undefined, {
        timeout: 2000,
      }),
    ).toBeInTheDocument();
    expect(
      screen.getByText('Service indisponible, réessayez dans un instant.'),
    ).toBeInTheDocument();
  });

  it('valide la semaine et notifie le parent du statut', async () => {
    const user = userEvent.setup();
    const onValide = vi.fn();
    const resultat: ValidationResultat = {
      contratId: 'c-lea',
      semaineIso: SEMAINE,
      statut: 'VALIDEE',
      deltaModifs: null,
    };
    vi.mocked(api.validerSemaine).mockResolvedValue(resultat);
    rendre(contratCreche(), { onValide });

    await user.click(screen.getByRole('button', { name: 'Valider' }));

    await waitFor(() => {
      expect(api.validerSemaine).toHaveBeenCalledWith('c-lea', SEMAINE);
    });
    expect(await screen.findByText('Semaine validée.')).toBeInTheDocument();
    expect(onValide).toHaveBeenCalledWith('VALIDEE');
  });

  it('signale une validation avec modifications', async () => {
    const user = userEvent.setup();
    const onValide = vi.fn();
    vi.mocked(api.validerSemaine).mockResolvedValue({
      contratId: 'c-lea',
      semaineIso: SEMAINE,
      statut: 'VALIDEE_AVEC_MODIFS',
      deltaModifs: { jours: [{ date: '2026-06-29', avant: null, apres: {} }] },
    });
    rendre(contratCreche(), { onValide });

    await user.click(screen.getByRole('button', { name: 'Valider' }));

    expect(
      await screen.findByText('Semaine validée (avec modifications).'),
    ).toBeInTheDocument();
    expect(onValide).toHaveBeenCalledWith('VALIDEE_AVEC_MODIFS');
  });

  it('affiche un message lisible quand la validation échoue', async () => {
    const user = userEvent.setup();
    vi.mocked(api.validerSemaine).mockRejectedValue(
      new ApiError(502, undefined),
    );
    rendre(contratCreche());

    await user.click(screen.getByRole('button', { name: 'Valider' }));

    expect(
      await screen.findByText(
        'Service indisponible, réessayez dans un instant.',
      ),
    ).toBeInTheDocument();
    // L'éditeur reste utilisable pour re-tenter.
    expect(screen.getByRole('button', { name: 'Valider' })).toBeEnabled();
  });
});

describe('EditeurContratSemaine (modes ABCM et ALSH)', () => {
  function contratAbcm(
    mode: 'CANTINE' | 'PERISCOLAIRE',
  ): ContratBesoinsSemaine {
    return {
      contratId: 'c-tom',
      enfant: 'Tom',
      mode,
      etablissementId: null,
      semaineAbcm: { MARDI: { cantine: true, periMatin: true } },
      besoins: {},
    };
  }

  it('cantine : repli sur la semaine-type puis ajustement daté', async () => {
    const user = userEvent.setup();
    rendre(contratAbcm('CANTINE'));

    // Mardi : base semaine-type « Cantine » ; lundi sans base → « — ».
    expect(screen.getByText('Cantine')).toBeInTheDocument();

    await user.click(
      screen.getByRole('button', { name: 'Saisir le Lundi 29/06/2026' }),
    );
    await user.click(screen.getByLabelText('Cantine'));
    await user.click(screen.getByRole('button', { name: 'Confirmer' }));

    const { corps } = await corpsEcrit();
    expect(corps.exceptions).toEqual([{ date: '2026-06-29', cantine: true }]);
    expect(screen.getAllByText('Cantine')).toHaveLength(2);
  });

  it('périscolaire : coche matin + soir et écrit l’exception datée', async () => {
    const user = userEvent.setup();
    rendre(contratAbcm('PERISCOLAIRE'));

    // Mardi : base péri matin.
    expect(screen.getByText('Péri matin')).toBeInTheDocument();

    await user.click(
      screen.getByRole('button', { name: 'Saisir le Lundi 29/06/2026' }),
    );
    await user.click(screen.getByLabelText('Matin'));
    await user.click(screen.getByLabelText('Soir'));
    await user.click(screen.getByRole('button', { name: 'Confirmer' }));

    const { corps } = await corpsEcrit();
    expect(corps.exceptions).toEqual([
      { date: '2026-06-29', periMatin: true, periSoir: true },
    ]);
    expect(screen.getByText('Péri matin + soir')).toBeInTheDocument();
  });

  it('ALSH : demi-journée saisie à côté de la journée existante', async () => {
    const user = userEvent.setup();
    rendre({
      contratId: 'c-zoe',
      enfant: 'Zoé',
      mode: 'ALSH',
      etablissementId: null,
      besoins: {
        '2026-06-29': {
          joursSupplementaires: [],
          absences: [],
          exceptions: [],
          joursAlsh: [{ date: '2026-06-29', type: 'COMPLETE', repas: true }],
        },
      },
    });

    expect(screen.getByText('Journée + repas')).toBeInTheDocument();

    await user.click(
      screen.getByRole('button', { name: 'Saisir le Mercredi 01/07/2026' }),
    );
    fireEvent.change(screen.getByLabelText('Type'), {
      target: { value: 'DEMI' },
    });
    await user.click(screen.getByRole('button', { name: 'Confirmer' }));

    const { corps } = await corpsEcrit();
    expect(corps.joursAlsh).toEqual([
      { date: '2026-06-29', type: 'COMPLETE', repas: true },
      { date: '2026-07-01', type: 'DEMI' },
    ]);
    expect(screen.getByText('Demi-journée')).toBeInTheDocument();
  });
});
