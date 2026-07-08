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
// Nom accessible du bouton « Valider » : aria-label suffixé enfant/mode, car
// l'éditeur hebdo empile un bloc (et donc un bouton) par contrat de la semaine.
const BOUTON_VALIDER =
  'Valider la semaine du 29 juin au 5 juillet — Léa, Crèche';
const JOURS = [
  '2026-06-29',
  '2026-06-30',
  '2026-07-01',
  '2026-07-02',
  '2026-07-03',
  '2026-07-04',
  '2026-07-05',
];

/** Contrat crèche gardé le mardi 09:00–16:30 (semaine-type), sans entrée datée. */
function contratCreche(): ContratBesoinsSemaine {
  return {
    contratId: 'c-lea',
    enfant: 'Léa',
    mode: 'CRECHE_PSU',
    etablissementId: null,
    semaineType: {
      MARDI: [
        { debutHeures: 9, debutMinutes: 0, finHeures: 16, finMinutes: 30 },
      ],
    },
    besoins: {},
  };
}

/** Idem, mais avec un ajustement d'heures réelles le mardi (arrivée avancée). */
function contratCrecheAvecAjustement(): ContratBesoinsSemaine {
  return {
    ...contratCreche(),
    besoins: {
      '2026-06-30': {
        joursSupplementaires: [],
        absences: [],
        ajustements: [
          {
            date: '2026-06-30',
            debutHeures: 8,
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
  it('initialise les besoins depuis le contrat : semaine-type gardée, jours vides', () => {
    rendre(contratCreche());

    expect(screen.getByText('Léa — Crèche')).toBeInTheDocument();
    // Mardi : jour gardé de la semaine-type → repli sur la base, bouton « Saisir ».
    expect(screen.getByText('Gardé 09:00–16:30')).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: 'Saisir le Mardi 30/06/2026' }),
    ).toBeInTheDocument();
    // Les 6 autres jours ne sont ni gardés ni saisis → « — ».
    expect(screen.getAllByText('—')).toHaveLength(6);
  });

  it('résume un ajustement d’heures existant par son libellé et sa présence réelle', () => {
    rendre(contratCrecheAvecAjustement());

    expect(screen.getByText('Arrivée avancée 08:00–16:30')).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: 'Modifier le Mardi 30/06/2026' }),
    ).toBeInTheDocument();
  });

  it('saisir une arrivée en avance : état « facturé en complément » puis entrée ajustements', async () => {
    const user = userEvent.setup();
    const onEnregistre = vi.fn();
    rendre(contratCreche(), { onEnregistre });

    await user.click(
      screen.getByRole('button', { name: 'Saisir le Mardi 30/06/2026' }),
    );
    // Champs préremplis avec la plage du contrat du jour.
    expect(screen.getByLabelText(/Heure d’arrivée/)).toHaveValue('09:00');
    expect(screen.getByLabelText(/Heure de départ/)).toHaveValue('16:30');

    fireEvent.change(screen.getByLabelText(/Heure d’arrivée/), {
      target: { value: '08:00' },
    });

    expect(
      screen.getByText(
        '1 h de plus que les horaires habituels (09:00–16:30) — facturé en complément.',
      ),
    ).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Confirmer' }));

    // Le résumé du jour reflète l'ajustement sans attendre l'écriture.
    expect(screen.getByText('Arrivée avancée 08:00–16:30')).toBeInTheDocument();
    expect(screen.getByText('Enregistrement…')).toBeInTheDocument();

    const { contratId, semaine, corps } = await corpsEcrit();
    expect(contratId).toBe('c-lea');
    expect(semaine).toBe(SEMAINE);
    expect(corps.ajustements).toEqual([
      {
        date: '2026-06-30',
        debutHeures: 8,
        debutMinutes: 0,
        finHeures: 16,
        finMinutes: 30,
        // Extension pure : préavis/certificat neutres.
        preavisJours: 0,
        certificatMaladie: false,
      },
    ]);
    expect(corps.absences).toBeUndefined();
    expect(corps.joursSupplementaires).toBeUndefined();
    await waitFor(() => {
      expect(onEnregistre).toHaveBeenCalled();
    });
    expect(
      await screen.findByText(/^Enregistré à \d{2}:\d{2}$/),
    ).toBeInTheDocument();
  });

  it('saisir une réduction : pose les questions préavis/certificat et les transmet', async () => {
    const user = userEvent.setup();
    rendre(contratCreche());

    await user.click(
      screen.getByRole('button', { name: 'Saisir le Mardi 30/06/2026' }),
    );
    fireEvent.change(screen.getByLabelText(/Heure d’arrivée/), {
      target: { value: '10:00' },
    });
    fireEvent.change(screen.getByLabelText(/Heure de départ/), {
      target: { value: '15:00' },
    });

    // 09:00→10:00 (1 h) + 15:00→16:30 (1 h 30) = 2 h 30 de moins.
    expect(
      screen.getByText(
        '2 h 30 de moins que les horaires habituels (09:00–16:30).',
      ),
    ).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText(/Signalée combien de jours/), {
      target: { value: '2' },
    });
    await user.click(screen.getByLabelText('Certificat médical'));
    await user.click(screen.getByRole('button', { name: 'Confirmer' }));

    const { corps } = await corpsEcrit();
    expect(corps.ajustements).toEqual([
      {
        date: '2026-06-30',
        debutHeures: 10,
        debutMinutes: 0,
        finHeures: 15,
        finMinutes: 0,
        preavisJours: 2,
        certificatMaladie: true,
      },
    ]);
  });

  it('saisir une arrivée avancée ET un départ avancé : état mixte', async () => {
    const user = userEvent.setup();
    rendre(contratCreche());

    await user.click(
      screen.getByRole('button', { name: 'Saisir le Mardi 30/06/2026' }),
    );
    fireEvent.change(screen.getByLabelText(/Heure d’arrivée/), {
      target: { value: '08:00' },
    });
    fireEvent.change(screen.getByLabelText(/Heure de départ/), {
      target: { value: '15:00' },
    });

    expect(
      screen.getByText(
        'Horaires ajustés (09:00–16:30 habituellement) : 1 h en plus (facturés en complément), 1 h 30 en moins.',
      ),
    ).toBeInTheDocument();
    // La réduction du mixte ouvre aussi les questions préavis/certificat.
    expect(
      screen.getByLabelText(/Signalée combien de jours/),
    ).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Confirmer' }));
    const { corps } = await corpsEcrit();
    expect(corps.ajustements).toEqual([
      {
        date: '2026-06-30',
        debutHeures: 8,
        debutMinutes: 0,
        finHeures: 15,
        finMinutes: 0,
        preavisJours: 0,
        certificatMaladie: false,
      },
    ]);
  });

  it('« Absent toute la journée » écrit une absence pleine plage de contrat', async () => {
    const user = userEvent.setup();
    rendre(contratCreche());

    await user.click(
      screen.getByRole('button', { name: 'Saisir le Mardi 30/06/2026' }),
    );
    await user.click(screen.getByLabelText('Absent toute la journée'));
    // Les champs d'heures disparaissent au profit des questions d'absence.
    expect(screen.queryByLabelText(/Heure d’arrivée/)).not.toBeInTheDocument();
    fireEvent.change(screen.getByLabelText(/Signalée combien de jours/), {
      target: { value: '3' },
    });
    await user.click(screen.getByLabelText('Certificat médical'));
    await user.click(screen.getByRole('button', { name: 'Confirmer' }));

    expect(screen.getByText('Absent (09:00–16:30)')).toBeInTheDocument();
    const { corps } = await corpsEcrit();
    expect(corps.absences).toEqual([
      {
        date: '2026-06-30',
        debutHeures: 9,
        debutMinutes: 0,
        finHeures: 16,
        finMinutes: 30,
        preavisJours: 3,
        certificatMaladie: true,
      },
    ]);
    expect(corps.ajustements).toBeUndefined();
  });

  it('heures identiques au contrat : « rien à enregistrer » et nettoyage de la saisie', async () => {
    const user = userEvent.setup();
    rendre(contratCrecheAvecAjustement());

    await user.click(
      screen.getByRole('button', { name: 'Modifier le Mardi 30/06/2026' }),
    );
    // Préremplie avec l'ajustement existant (08:00) ; on revient au contrat.
    expect(screen.getByLabelText(/Heure d’arrivée/)).toHaveValue('08:00');
    fireEvent.change(screen.getByLabelText(/Heure d’arrivée/), {
      target: { value: '09:00' },
    });
    expect(
      screen.getByText('Horaires habituels — rien à enregistrer.'),
    ).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Confirmer' }));

    // La saisie du jour est retirée : retour à l'affichage de base.
    expect(screen.getByText('Gardé 09:00–16:30')).toBeInTheDocument();
    const { corps } = await corpsEcrit();
    expect(corps).toEqual({});
  });

  it('refuse une plage invalide : message et confirmation désactivée', async () => {
    const user = userEvent.setup();
    rendre(contratCreche());

    await user.click(
      screen.getByRole('button', { name: 'Saisir le Mardi 30/06/2026' }),
    );
    // Départ avant l'arrivée du contrat (09:00).
    fireEvent.change(screen.getByLabelText(/Heure de départ/), {
      target: { value: '08:00' },
    });

    expect(
      screen.getByText('L’heure de départ doit être postérieure à l’arrivée.'),
    ).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Confirmer' })).toBeDisabled();
    expect(api.ecrireSemaineBesoins).not.toHaveBeenCalled();
  });

  it('jour non gardé : pas de case « Absent », c’est un « jour ajouté »', async () => {
    const user = userEvent.setup();
    rendre(contratCreche());

    await user.click(
      screen.getByRole('button', { name: 'Saisir le Mercredi 01/07/2026' }),
    );
    // Aucune case « Absent toute la journée » ni état déduit sur un jour non gardé.
    expect(
      screen.queryByLabelText('Absent toute la journée'),
    ).not.toBeInTheDocument();
    fireEvent.change(screen.getByLabelText(/Heure d’arrivée/), {
      target: { value: '08:30' },
    });
    fireEvent.change(screen.getByLabelText(/Heure de départ/), {
      target: { value: '17:30' },
    });
    await user.click(screen.getByRole('button', { name: 'Confirmer' }));

    expect(screen.getByText('Jour ajouté (08:30–17:30)')).toBeInTheDocument();
    const { corps } = await corpsEcrit();
    expect(corps.joursSupplementaires).toEqual([
      {
        date: '2026-07-01',
        debutHeures: 8,
        debutMinutes: 30,
        finHeures: 17,
        finMinutes: 30,
      },
    ]);
    expect(corps.ajustements).toBeUndefined();
  });

  it('supprime l’ajustement d’un jour (corps vidé)', async () => {
    const user = userEvent.setup();
    rendre(contratCrecheAvecAjustement());

    await user.click(
      screen.getByRole('button', { name: 'Modifier le Mardi 30/06/2026' }),
    );
    await user.click(screen.getByRole('button', { name: 'Supprimer' }));

    const { corps } = await corpsEcrit();
    // Plus aucune catégorie datée : le corps est vide.
    expect(corps).toEqual({});
    // La rangée du mardi retombe sur sa base « Gardé ».
    expect(screen.getByText('Gardé 09:00–16:30')).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: 'Saisir le Mardi 30/06/2026' }),
    ).toBeInTheDocument();
  });

  it('affiche l’erreur d’enregistrement quand l’écriture échoue', async () => {
    const user = userEvent.setup();
    vi.mocked(api.ecrireSemaineBesoins).mockRejectedValue(
      new ApiError(502, undefined),
    );
    rendre(contratCrecheAvecAjustement());

    await user.click(
      screen.getByRole('button', { name: 'Modifier le Mardi 30/06/2026' }),
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

  it('« Réessayer » après une erreur rejoue l’écriture et affiche « Enregistré »', async () => {
    const user = userEvent.setup();
    vi.mocked(api.ecrireSemaineBesoins)
      .mockRejectedValueOnce(new ApiError(502, undefined))
      .mockResolvedValueOnce(undefined);
    rendre(contratCrecheAvecAjustement());

    await user.click(
      screen.getByRole('button', { name: 'Modifier le Mardi 30/06/2026' }),
    );
    await user.click(screen.getByRole('button', { name: 'Supprimer' }));

    const reessayer = await screen.findByRole(
      'button',
      { name: 'Réessayer' },
      { timeout: 2000 },
    );
    await user.click(reessayer);

    expect(
      await screen.findByText(/^Enregistré à \d{2}:\d{2}$/, undefined, {
        timeout: 2000,
      }),
    ).toBeInTheDocument();
    expect(api.ecrireSemaineBesoins).toHaveBeenCalledTimes(2);
    // La reprise rejoue le même corps que l'écriture échouée.
    const appels = vi.mocked(api.ecrireSemaineBesoins).mock.calls;
    expect(appels[1]?.slice(0, 3)).toEqual(appels[0]?.slice(0, 3));
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

    await user.click(screen.getByRole('button', { name: BOUTON_VALIDER }));

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

    await user.click(screen.getByRole('button', { name: BOUTON_VALIDER }));

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

    await user.click(screen.getByRole('button', { name: BOUTON_VALIDER }));

    expect(
      await screen.findByText(
        'Service indisponible, réessayez dans un instant.',
      ),
    ).toBeInTheDocument();
    // L'éditeur reste utilisable pour re-tenter.
    expect(screen.getByRole('button', { name: BOUTON_VALIDER })).toBeEnabled();
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
          ajustements: [],
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

  // ALSH récurrent : semaine-type sur MERCREDI (2026-07-01 dans la semaine).
  function contratAlshRecurrent(): ContratBesoinsSemaine {
    return {
      contratId: 'c-noa',
      enfant: 'Noa',
      mode: 'ALSH',
      etablissementId: null,
      semaineAbcm: { MERCREDI: { alsh: { type: 'COMPLETE', repas: true } } },
      besoins: {},
    };
  }

  it('ALSH : la récurrence hebdomadaire est affichée sur son jour de semaine', () => {
    rendre(contratAlshRecurrent());
    // Mercredi 01/07 réservé par récurrence → « Journée + repas » + « Modifier ».
    expect(screen.getByText('Journée + repas')).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: 'Modifier le Mercredi 01/07/2026' }),
    ).toBeInTheDocument();
    // Les autres jours ne portent pas la récurrence → « — » + « Saisir ».
    expect(
      screen.getByRole('button', { name: 'Saisir le Lundi 29/06/2026' }),
    ).toBeInTheDocument();
  });

  it('ALSH : retirer un jour récurrent écrit une exception `alsh:false`', async () => {
    const user = userEvent.setup();
    rendre(contratAlshRecurrent());

    await user.click(
      screen.getByRole('button', { name: 'Modifier le Mercredi 01/07/2026' }),
    );
    await user.click(screen.getByRole('button', { name: 'Supprimer' }));

    const { corps } = await corpsEcrit();
    expect(corps.exceptions).toEqual([{ date: '2026-07-01', alsh: false }]);
    expect(corps.joursAlsh).toBeUndefined();
    // Le jour retombe sur « — » et le bouton redevient « Saisir ».
    expect(
      screen.getByRole('button', { name: 'Saisir le Mercredi 01/07/2026' }),
    ).toBeInTheDocument();
  });

  it('ALSH : un jour explicite prime sur la récurrence du même jour', () => {
    rendre({
      contratId: 'c-noa',
      enfant: 'Noa',
      mode: 'ALSH',
      etablissementId: null,
      semaineAbcm: { MERCREDI: { alsh: { type: 'COMPLETE', repas: true } } },
      besoins: {
        '2026-07-01': {
          joursSupplementaires: [],
          absences: [],
          ajustements: [],
          exceptions: [],
          joursAlsh: [{ date: '2026-07-01', type: 'DEMI' }],
        },
      },
    });
    // L'explicite (demi-journée) l'emporte sur la récurrence (journée + repas).
    expect(screen.getByText('Demi-journée')).toBeInTheDocument();
    expect(screen.queryByText('Journée + repas')).not.toBeInTheDocument();
  });

  it('ALSH : un jour déjà retiré par exception s’affiche « — »', () => {
    rendre({
      contratId: 'c-noa',
      enfant: 'Noa',
      mode: 'ALSH',
      etablissementId: null,
      semaineAbcm: { MERCREDI: { alsh: { type: 'COMPLETE' } } },
      besoins: {
        '2026-07-01': {
          joursSupplementaires: [],
          absences: [],
          ajustements: [],
          exceptions: [{ date: '2026-07-01', alsh: false }],
          joursAlsh: [],
        },
      },
    });
    expect(
      screen.getByRole('button', { name: 'Saisir le Mercredi 01/07/2026' }),
    ).toBeInTheDocument();
  });
});
