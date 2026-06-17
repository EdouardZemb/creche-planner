import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { CalendrierAbcm } from './CalendrierAbcm';
import type { ContratLocal } from '../types/bff';

// Mock api/client
vi.mock('../api/client', () => ({
  api: {
    ecrirePlanning: vi.fn(),
    lirePlanning: vi.fn(),
    modifierContrat: vi.fn(),
  },
  ApiError: class ApiError extends Error {
    status: number;
    corps: unknown;
    constructor(status: number, corps: unknown) {
      super(`HTTP ${status}`);
      this.status = status;
      this.corps = corps;
    }
  },
}));

// Mock FullCalendar
vi.mock('@fullcalendar/react', () => ({
  default: ({
    events,
    dateClick,
  }: {
    events?: Array<{ id?: string }>;
    dateClick?: (arg: { dateStr: string }) => void;
  }) => (
    <div data-testid="fullcalendar">
      <span data-testid="event-count">
        {Array.isArray(events) ? events.length : 0}
      </span>
      {dateClick && (
        <>
          <button
            data-testid="simulate-date-click"
            onClick={() => dateClick({ dateStr: '2026-07-02' })}
          >
            Simuler clic ALSH
          </button>
          {/* 2026-06-01 = lundi (réservé), 2026-06-05 = vendredi (libre) */}
          <button
            data-testid="simulate-date-click-reserve"
            onClick={() => dateClick({ dateStr: '2026-06-01' })}
          >
            Simuler clic réservé
          </button>
          <button
            data-testid="simulate-date-click-libre"
            onClick={() => dateClick({ dateStr: '2026-06-05' })}
          >
            Simuler clic libre
          </button>
        </>
      )}
    </div>
  ),
}));

vi.mock('@fullcalendar/daygrid', () => ({ default: {} }));
vi.mock('@fullcalendar/interaction', () => ({ default: {} }));

import { api, ApiError } from '../api/client';

const contratCantine: ContratLocal = {
  id: 'contrat-cantine-1',
  foyerId: 'foyer-1',
  enfant: 'enfant-1',
  mode: 'CANTINE',
  valideDu: '2026-01-01',
  valideAu: null,
  semaineAbcm: {
    LUNDI: { cantine: true },
    MERCREDI: { cantine: true },
  },
};

const contratAlsh: ContratLocal = {
  id: 'contrat-alsh-1',
  foyerId: 'foyer-1',
  enfant: 'enfant-1',
  mode: 'ALSH',
  valideDu: '2026-07-01',
  valideAu: '2026-07-31',
  semaineAbcm: {},
};

const contratPeriscolaire: ContratLocal = {
  id: 'contrat-peri-1',
  foyerId: 'foyer-1',
  enfant: 'enfant-1',
  mode: 'PERISCOLAIRE',
  valideDu: '2026-01-01',
  valideAu: null,
  semaineAbcm: {
    LUNDI: { periMatin: true, periSoir: true },
    MARDI: { periMatin: true },
  },
};

describe('CalendrierAbcm - CANTINE', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(api.lirePlanning).mockResolvedValue({ saisie: null });
  });

  it('se rend sans erreur', () => {
    render(
      <CalendrierAbcm
        contrat={contratCantine}
        mois="2026-06"
        simule={false}
        onEnregistre={vi.fn()}
      />,
    );
    expect(screen.getByTestId('fullcalendar')).toBeInTheDocument();
  });

  it('affiche la checkbox PAI', () => {
    render(
      <CalendrierAbcm
        contrat={contratCantine}
        mois="2026-06"
        simule={false}
        onEnregistre={vi.fn()}
      />,
    );
    expect(screen.getByText(/PAI/i)).toBeInTheDocument();
  });

  it('genere des evenements pour les jours cantine reserves', () => {
    render(
      <CalendrierAbcm
        contrat={contratCantine}
        mois="2026-06"
        simule={false}
        onEnregistre={vi.fn()}
      />,
    );
    const count = parseInt(
      screen.getByTestId('event-count').textContent ?? '0',
      10,
    );
    // Juin 2026 : lundis et mercredis = plusieurs jours
    expect(count).toBeGreaterThan(0);
  });

  it('appelle ecrirePlanning avec pai=true quand PAI coche', async () => {
    vi.mocked(api.ecrirePlanning).mockResolvedValue(undefined);
    const onEnregistre = vi.fn();

    render(
      <CalendrierAbcm
        contrat={contratCantine}
        mois="2026-06"
        simule={false}
        onEnregistre={onEnregistre}
      />,
    );

    const checkboxPai = screen.getByRole('checkbox');
    fireEvent.click(checkboxPai);

    await waitFor(
      () => {
        expect(api.ecrirePlanning).toHaveBeenCalledWith(
          'contrat-cantine-1',
          '2026-06',
          false,
          expect.objectContaining({ pai: true }),
          expect.any(Object),
        );
      },
      { timeout: 2000 },
    );
    await waitFor(() => expect(onEnregistre).toHaveBeenCalled(), {
      timeout: 2000,
    });
  });

  it('nomme chaque bouton « Ajuster » avec sa date et son état (nom accessible unique)', () => {
    render(
      <CalendrierAbcm
        contrat={contratCantine}
        mois="2026-06"
        simule={false}
        onEnregistre={vi.fn()}
      />,
    );

    // 01/06 (lundi) est réservé en cantine ; 05/06 (vendredi) ne l'est pas.
    expect(
      screen.getByRole('button', {
        name: /Ajuster le 01\/06\/2026 \(réservé\)/i,
      }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole('button', {
        name: /Ajuster le 05\/06\/2026 \(non réservé\)/i,
      }),
    ).toBeInTheDocument();
  });

  it('retire un jour de cantine reserve via une exception (cantine=false)', async () => {
    vi.mocked(api.ecrirePlanning).mockResolvedValue(undefined);

    render(
      <CalendrierAbcm
        contrat={contratCantine}
        mois="2026-06"
        simule={false}
        onEnregistre={vi.fn()}
      />,
    );

    // 01/06 (lundi) est réservé : la modale s'ouvre avec « Cantine » coché.
    fireEvent.click(screen.getByTestId('simulate-date-click-reserve'));
    const caseCantine = screen.getByLabelText('Cantine');
    expect(caseCantine).toBeChecked();
    fireEvent.click(caseCantine); // décoche → retrait
    fireEvent.click(screen.getByText('Confirmer'));

    await waitFor(
      () => {
        expect(api.ecrirePlanning).toHaveBeenCalledWith(
          'contrat-cantine-1',
          '2026-06',
          false,
          expect.objectContaining({
            exceptions: expect.arrayContaining([
              expect.objectContaining({ date: '2026-06-01', cantine: false }),
            ]),
          }),
          expect.any(Object),
        );
      },
      { timeout: 2000 },
    );
  });

  it('ajoute un jour de cantine libre via une exception (cantine=true)', async () => {
    vi.mocked(api.ecrirePlanning).mockResolvedValue(undefined);

    render(
      <CalendrierAbcm
        contrat={contratCantine}
        mois="2026-06"
        simule={false}
        onEnregistre={vi.fn()}
      />,
    );

    // 05/06 (vendredi) n'est pas réservé : « Cantine » décoché à l'ouverture.
    fireEvent.click(screen.getByTestId('simulate-date-click-libre'));
    const caseCantine = screen.getByLabelText('Cantine');
    expect(caseCantine).not.toBeChecked();
    fireEvent.click(caseCantine); // coche → ajout
    fireEvent.click(screen.getByText('Confirmer'));

    await waitFor(
      () => {
        expect(api.ecrirePlanning).toHaveBeenCalledWith(
          'contrat-cantine-1',
          '2026-06',
          false,
          expect.objectContaining({
            exceptions: expect.arrayContaining([
              expect.objectContaining({ date: '2026-06-05', cantine: true }),
            ]),
          }),
          expect.any(Object),
        );
      },
      { timeout: 2000 },
    );
  });
});

describe('CalendrierAbcm - PERISCOLAIRE', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(api.lirePlanning).mockResolvedValue({ saisie: null });
  });

  it('se rend sans erreur', () => {
    render(
      <CalendrierAbcm
        contrat={contratPeriscolaire}
        mois="2026-06"
        simule={false}
        onEnregistre={vi.fn()}
      />,
    );
    expect(screen.getByTestId('fullcalendar')).toBeInTheDocument();
  });

  it('ne montre pas la checkbox PAI', () => {
    render(
      <CalendrierAbcm
        contrat={contratPeriscolaire}
        mois="2026-06"
        simule={false}
        onEnregistre={vi.fn()}
      />,
    );
    expect(screen.queryByText(/PAI/i)).not.toBeInTheDocument();
  });

  it('genere des evenements pour les jours peri', () => {
    render(
      <CalendrierAbcm
        contrat={contratPeriscolaire}
        mois="2026-06"
        simule={false}
        onEnregistre={vi.fn()}
      />,
    );
    const count = parseInt(
      screen.getByTestId('event-count').textContent ?? '0',
      10,
    );
    expect(count).toBeGreaterThan(0);
  });

  it('retire le matin d un jour peri via une exception (periMatin=false)', async () => {
    vi.mocked(api.ecrirePlanning).mockResolvedValue(undefined);

    render(
      <CalendrierAbcm
        contrat={contratPeriscolaire}
        mois="2026-06"
        simule={false}
        onEnregistre={vi.fn()}
      />,
    );

    // 01/06 (lundi) : matin + soir réservés. On décoche le matin.
    fireEvent.click(screen.getByTestId('simulate-date-click-reserve'));
    const caseMatin = screen.getByLabelText('Matin');
    const caseSoir = screen.getByLabelText('Soir');
    expect(caseMatin).toBeChecked();
    expect(caseSoir).toBeChecked();
    fireEvent.click(caseMatin); // décoche le matin
    fireEvent.click(screen.getByText('Confirmer'));

    await waitFor(
      () => {
        expect(api.ecrirePlanning).toHaveBeenCalledWith(
          'contrat-peri-1',
          '2026-06',
          false,
          expect.objectContaining({
            exceptions: expect.arrayContaining([
              expect.objectContaining({ date: '2026-06-01', periMatin: false }),
            ]),
          }),
          expect.any(Object),
        );
      },
      { timeout: 2000 },
    );
  });
});

describe('CalendrierAbcm - ALSH', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(api.lirePlanning).mockResolvedValue({ saisie: null });
  });

  it('se rend sans erreur', () => {
    render(
      <CalendrierAbcm
        contrat={contratAlsh}
        mois="2026-07"
        simule={false}
        onEnregistre={vi.fn()}
      />,
    );
    expect(screen.getByTestId('fullcalendar')).toBeInTheDocument();
  });

  it('affiche le message d aide ALSH', () => {
    render(
      <CalendrierAbcm
        contrat={contratAlsh}
        mois="2026-07"
        simule={false}
        onEnregistre={vi.fn()}
      />,
    );
    expect(
      screen.getByText(/Cliquer sur un jour pour ajouter/i),
    ).toBeInTheDocument();
  });

  it('ouvre le popover apres clic sur un jour', () => {
    render(
      <CalendrierAbcm
        contrat={contratAlsh}
        mois="2026-07"
        simule={false}
        onEnregistre={vi.fn()}
      />,
    );

    fireEvent.click(screen.getByTestId('simulate-date-click'));
    expect(
      screen.getByText(/Journée ALSH du 02\/07\/2026/i),
    ).toBeInTheDocument();
  });

  it('expose une modale accessible (role=dialog) a l ouverture (EX-09)', () => {
    render(
      <CalendrierAbcm
        contrat={contratAlsh}
        mois="2026-07"
        simule={false}
        onEnregistre={vi.fn()}
      />,
    );

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    fireEvent.click(screen.getByTestId('simulate-date-click'));
    expect(screen.getByRole('dialog')).toBeInTheDocument();
  });

  it('permet d ouvrir la saisie ALSH au clavier via la liste (EX-08)', () => {
    render(
      <CalendrierAbcm
        contrat={contratAlsh}
        mois="2026-07"
        simule={false}
        onEnregistre={vi.fn()}
      />,
    );

    const boutonsSaisir = screen.getAllByRole('button', { name: /Saisir/i });
    expect(boutonsSaisir.length).toBeGreaterThan(0);

    fireEvent.click(boutonsSaisir[0]!);
    expect(screen.getByRole('dialog')).toBeInTheDocument();
  });

  it('nomme chaque bouton de la liste ALSH avec sa date (nom accessible unique)', () => {
    render(
      <CalendrierAbcm
        contrat={contratAlsh}
        mois="2026-07"
        simule={false}
        onEnregistre={vi.fn()}
      />,
    );

    // Sans saisie : « Saisir une journée ALSH le <date> ».
    expect(
      screen.getAllByRole('button', {
        name: /Saisir une journée ALSH le/i,
      }).length,
    ).toBeGreaterThan(0);
  });

  it('appelle ecrirePlanning avec joursAlsh apres confirmation', async () => {
    vi.mocked(api.ecrirePlanning).mockResolvedValue(undefined);
    const onEnregistre = vi.fn();

    render(
      <CalendrierAbcm
        contrat={contratAlsh}
        mois="2026-07"
        simule={false}
        onEnregistre={onEnregistre}
      />,
    );

    fireEvent.click(screen.getByTestId('simulate-date-click'));
    fireEvent.click(screen.getByText('Confirmer'));

    await waitFor(
      () => {
        expect(api.ecrirePlanning).toHaveBeenCalledWith(
          'contrat-alsh-1',
          '2026-07',
          false,
          expect.objectContaining({ joursAlsh: expect.any(Array) }),
          expect.any(Object),
        );
      },
      { timeout: 2000 },
    );
    await waitFor(() => expect(onEnregistre).toHaveBeenCalled(), {
      timeout: 2000,
    });
  });

  it('ferme le popover en cliquant Annuler', () => {
    render(
      <CalendrierAbcm
        contrat={contratAlsh}
        mois="2026-07"
        simule={false}
        onEnregistre={vi.fn()}
      />,
    );

    fireEvent.click(screen.getByTestId('simulate-date-click'));
    expect(
      screen.getByText(/Journée ALSH du 02\/07\/2026/i),
    ).toBeInTheDocument();

    fireEvent.click(screen.getByText('Annuler'));
    expect(
      screen.queryByText(/Journée ALSH du 02\/07\/2026/i),
    ).not.toBeInTheDocument();
  });

  // Invariant MBT : un échec de modification durable (429 / réseau) ne doit JAMAIS
  // détruire l'état — on affiche une erreur et le contrat reste en place.
  it('modif durable en echec (429) : affiche une erreur sans detruire l etat', async () => {
    vi.mocked(api.modifierContrat).mockRejectedValue(
      new ApiError(429, 'trop de requêtes'),
    );

    render(
      <CalendrierAbcm
        contrat={contratCantine}
        mois="2026-06"
        simule={false}
        onEnregistre={vi.fn()}
        onContratModifie={vi.fn()}
      />,
    );

    // Ouvre un jour réservé (lundi) ; le choix de portée est dans le dialog.
    fireEvent.click(screen.getByTestId('simulate-date-click-reserve'));
    // Portée « tous les mois » = modification durable du contrat.
    fireEvent.click(screen.getByLabelText(/Tous les mois/i));
    fireEvent.click(screen.getByText('Confirmer'));
    // Confirme la modification durable → PUT contrat (mocké en échec 429).
    fireEvent.click(screen.getByText('Modifier le contrat'));

    // L'erreur est rendue (et non avalée silencieusement) ; le PUT a bien eu lieu.
    const alerte = await screen.findByText(/Erreur 429/i);
    expect(alerte).toBeInTheDocument();
    expect(api.modifierContrat).toHaveBeenCalledTimes(1);
  });
});

// AQ-05 : chaque mutation du calendrier est annoncée dans une région live
// (`role="status"`, polite) pour les lecteurs d'écran.
describe('CalendrierAbcm - annonces aria-live (AQ-05)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(api.lirePlanning).mockResolvedValue({ saisie: null });
  });

  it('expose une région live polite de rôle status', () => {
    const { container } = render(
      <CalendrierAbcm
        contrat={contratCantine}
        mois="2026-06"
        simule={false}
        onEnregistre={vi.fn()}
      />,
    );
    const region = container.querySelector('p.sr-only[aria-live="polite"]');
    expect(region).not.toBeNull();
    expect(region).toHaveAttribute('role', 'status');
  });

  it('annonce un ajustement cantine confirmé', () => {
    render(
      <CalendrierAbcm
        contrat={contratCantine}
        mois="2026-06"
        simule={false}
        onEnregistre={vi.fn()}
      />,
    );

    // 2026-06-05 (vendredi, hors template) : cocher la cantine crée une exception.
    fireEvent.click(screen.getByTestId('simulate-date-click-libre'));
    fireEvent.click(screen.getByLabelText('Cantine'));
    fireEvent.click(screen.getByText('Confirmer'));

    expect(screen.getByText(/Jour ajusté le 05\/06\/2026/)).toBeInTheDocument();
  });

  it("annonce le retrait d'un ajustement remis au contrat", () => {
    render(
      <CalendrierAbcm
        contrat={contratCantine}
        mois="2026-06"
        simule={false}
        onEnregistre={vi.fn()}
      />,
    );

    // Crée une exception le 05/06, puis la retire en décochant (retour au template).
    fireEvent.click(screen.getByTestId('simulate-date-click-libre'));
    fireEvent.click(screen.getByLabelText('Cantine'));
    fireEvent.click(screen.getByText('Confirmer'));
    fireEvent.click(screen.getByTestId('simulate-date-click-libre'));
    fireEvent.click(screen.getByLabelText('Cantine'));
    fireEvent.click(screen.getByText('Confirmer'));

    expect(
      screen.getByText(/Ajustement retiré le 05\/06\/2026/),
    ).toBeInTheDocument();
  });

  it("annonce l'ajout puis le retrait d'une journée ALSH", () => {
    render(
      <CalendrierAbcm
        contrat={contratAlsh}
        mois="2026-07"
        simule={false}
        onEnregistre={vi.fn()}
      />,
    );

    fireEvent.click(screen.getByTestId('simulate-date-click'));
    fireEvent.click(screen.getByText('Confirmer'));
    expect(
      screen.getByText(/Journée ALSH ajoutée le 02\/07\/2026/),
    ).toBeInTheDocument();

    fireEvent.click(screen.getByTestId('simulate-date-click'));
    fireEvent.click(screen.getByText('Supprimer'));
    expect(
      screen.getByText(/Journée ALSH retirée le 02\/07\/2026/),
    ).toBeInTheDocument();
  });
});
