import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { CalendrierCreche } from './CalendrierCreche';
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

// Mock FullCalendar : expose un bouton cliquable par date pour simuler dateClick
vi.mock('@fullcalendar/react', () => ({
  default: ({
    events,
    dateClick,
  }: {
    events?: { id?: string }[];
    dateClick?: (arg: { dateStr: string }) => void;
  }) => (
    <div data-testid="fullcalendar">
      <span data-testid="event-count">
        {Array.isArray(events) ? events.length : 0}
      </span>
      {/* Boutons de test : clic sur un jour gardé (mardi) et sur un jour libre (samedi) */}
      {dateClick && (
        <>
          <button
            data-testid="simulate-date-click"
            onClick={() => {
              dateClick({ dateStr: '2026-06-02' });
            }}
          >
            Simuler clic
          </button>
          <button
            data-testid="simulate-date-click-libre"
            onClick={() => {
              dateClick({ dateStr: '2026-06-06' });
            }}
          >
            Simuler clic jour libre
          </button>
        </>
      )}
    </div>
  ),
}));

vi.mock('@fullcalendar/daygrid', () => ({ default: {} }));
vi.mock('@fullcalendar/interaction', () => ({ default: {} }));

import { api, ApiError } from '../api/client';

const contratCreche: ContratLocal = {
  id: 'contrat-creche-1',
  foyerId: 'foyer-1',
  enfant: 'enfant-1',
  mode: 'CRECHE_PSU',
  valideDu: '2026-01-01',
  valideAu: null,
  semaineType: {
    // LUNDI = 2026-06-01 est un lundi, 2026-06-02 est un mardi
    LUNDI: [{ debutHeures: 8, debutMinutes: 0, finHeures: 17, finMinutes: 0 }],
    MARDI: [{ debutHeures: 8, debutMinutes: 0, finHeures: 17, finMinutes: 0 }],
  },
};

describe('CalendrierCreche', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    sessionStorage.clear();
    // Par défaut : aucune saisie serveur enregistrée (le brouillon local prime).
    vi.mocked(api.lirePlanning).mockResolvedValue({ saisie: null });
  });

  it('se rend sans erreur', () => {
    render(
      <CalendrierCreche
        contrat={contratCreche}
        mois="2026-06"
        simule={false}
        onEnregistre={vi.fn()}
      />,
    );

    expect(screen.getByTestId('fullcalendar')).toBeInTheDocument();
  });

  it('affiche le champ complement minutes', () => {
    render(
      <CalendrierCreche
        contrat={contratCreche}
        mois="2026-06"
        simule={false}
        onEnregistre={vi.fn()}
      />,
    );

    expect(screen.getByText(/Complément \(min\)/i)).toBeInTheDocument();
  });

  it('genere des evenements pour les jours gardes du mois', () => {
    render(
      <CalendrierCreche
        contrat={contratCreche}
        mois="2026-06"
        simule={false}
        onEnregistre={vi.fn()}
      />,
    );

    // Juin 2026 : les lundis et mardis gardés
    const count = parseInt(
      screen.getByTestId('event-count').textContent ?? '0',
      10,
    );
    expect(count).toBeGreaterThan(0);
  });

  it('ouvre le dialog absence apres clic sur un jour garde', () => {
    render(
      <CalendrierCreche
        contrat={contratCreche}
        mois="2026-06"
        simule={false}
        onEnregistre={vi.fn()}
      />,
    );

    // 2026-06-02 est un mardi (garde), titre au format francais
    fireEvent.click(screen.getByTestId('simulate-date-click'));

    expect(screen.getByText(/Absence du 02\/06\/2026/i)).toBeInTheDocument();
  });

  it('expose une modale accessible (role=dialog) a l ouverture (EX-09)', () => {
    render(
      <CalendrierCreche
        contrat={contratCreche}
        mois="2026-06"
        simule={false}
        onEnregistre={vi.fn()}
      />,
    );

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    fireEvent.click(screen.getByTestId('simulate-date-click'));
    expect(screen.getByRole('dialog')).toBeInTheDocument();
  });

  it('permet d ouvrir la saisie au clavier via la liste des jours (EX-08)', () => {
    render(
      <CalendrierCreche
        contrat={contratCreche}
        mois="2026-06"
        simule={false}
        onEnregistre={vi.fn()}
      />,
    );

    // La liste clavier propose un bouton « Saisir » par jour garde.
    const boutonsSaisir = screen.getAllByRole('button', { name: /Saisir/i });
    expect(boutonsSaisir.length).toBeGreaterThan(0);

    fireEvent.click(boutonsSaisir[0]!);
    expect(screen.getByRole('dialog')).toBeInTheDocument();
  });

  it('nomme chaque bouton de la liste clavier avec sa date (nom accessible unique)', () => {
    render(
      <CalendrierCreche
        contrat={contratCreche}
        mois="2026-06"
        simule={false}
        onEnregistre={vi.fn()}
      />,
    );

    // Bouton contextualisé : « Saisir une absence le <date> » plutôt que « Saisir ».
    expect(
      screen.getByRole('button', {
        name: /Saisir une absence le 02\/06\/2026/i,
      }),
    ).toBeInTheDocument();
  });

  it('reflète l état d absence dans le nom accessible du bouton (Modifier)', () => {
    render(
      <CalendrierCreche
        contrat={contratCreche}
        mois="2026-06"
        simule={false}
        onEnregistre={vi.fn()}
      />,
    );

    // Avant saisie : « Saisir une absence le … ».
    expect(
      screen.getByRole('button', {
        name: /Saisir une absence le 02\/06\/2026/i,
      }),
    ).toBeInTheDocument();

    // Après saisie d'une absence le 02/06, le bouton devient « Modifier l'absence du … ».
    fireEvent.click(screen.getByTestId('simulate-date-click'));
    fireEvent.click(screen.getByText('Confirmer'));

    expect(
      screen.getByRole('button', {
        name: /Modifier l.absence du 02\/06\/2026/i,
      }),
    ).toBeInTheDocument();
  });

  it('appelle api.ecrirePlanning apres confirmation absence', async () => {
    vi.mocked(api.ecrirePlanning).mockResolvedValue(undefined);
    const onEnregistre = vi.fn();

    render(
      <CalendrierCreche
        contrat={contratCreche}
        mois="2026-06"
        simule={false}
        onEnregistre={onEnregistre}
      />,
    );

    // Ouvrir dialog
    fireEvent.click(screen.getByTestId('simulate-date-click'));

    // Confirmer
    fireEvent.click(screen.getByText('Confirmer'));

    // Attendre l'appel API (debounce 800ms dans le hook)
    await waitFor(
      () => {
        expect(api.ecrirePlanning).toHaveBeenCalledWith(
          'contrat-creche-1',
          '2026-06',
          false,
          expect.objectContaining({ absences: expect.any(Array) }),
          expect.any(Object),
        );
      },
      { timeout: 2000 },
    );

    await waitFor(
      () => {
        expect(onEnregistre).toHaveBeenCalled();
      },
      {
        timeout: 2000,
      },
    );
  });

  it('ouvre le dialog d ajout apres clic sur un jour non garde', () => {
    render(
      <CalendrierCreche
        contrat={contratCreche}
        mois="2026-06"
        simule={false}
        onEnregistre={vi.fn()}
      />,
    );

    // 2026-06-06 est un samedi (non gardé) : la modale propose un ajout.
    fireEvent.click(screen.getByTestId('simulate-date-click-libre'));
    expect(screen.getByText(/Ajouter le 06\/06\/2026/i)).toBeInTheDocument();
  });

  it('envoie un jour supplementaire apres confirmation d ajout', async () => {
    vi.mocked(api.ecrirePlanning).mockResolvedValue(undefined);

    render(
      <CalendrierCreche
        contrat={contratCreche}
        mois="2026-06"
        simule={false}
        onEnregistre={vi.fn()}
      />,
    );

    fireEvent.click(screen.getByTestId('simulate-date-click-libre'));
    fireEvent.click(screen.getByText('Confirmer'));

    await waitFor(
      () => {
        expect(api.ecrirePlanning).toHaveBeenCalledWith(
          'contrat-creche-1',
          '2026-06',
          false,
          expect.objectContaining({
            joursSupplementaires: expect.arrayContaining([
              expect.objectContaining({ date: '2026-06-06' }),
            ]),
          }),
          expect.any(Object),
        );
      },
      { timeout: 2000 },
    );
  });

  it('hydrate la saisie depuis le serveur (ajustement intérieur → « Ajusté »)', async () => {
    // Fenêtre 9–11 intérieure à la garde MARDI (08:00–17:00) : ce n'est pas une
    // absence pleine journée mais un simple ajustement → « Ajusté » (et non « Absent »).
    vi.mocked(api.lirePlanning).mockResolvedValue({
      saisie: {
        absences: [
          {
            date: '2026-06-02',
            debutHeures: 9,
            debutMinutes: 0,
            finHeures: 11,
            finMinutes: 0,
            preavisJours: 3,
            certificatMaladie: false,
          },
        ],
      },
    });

    render(
      <CalendrierCreche
        contrat={contratCreche}
        mois="2026-06"
        simule={false}
        onEnregistre={vi.fn()}
      />,
    );

    // La ligne du 02/06 doit refléter l'absence venue du serveur, classée « Ajusté ».
    await waitFor(() => {
      const ligne = screen.getByText('02/06/2026').closest('li');
      expect(ligne?.textContent).toContain('Ajusté');
      expect(ligne?.textContent).not.toContain('Absent');
    });
  });

  it('classe une absence de fin de journée en « Départ avancé »', async () => {
    // Fenêtre 15:00–17:00 finissant avec la garde MARDI (08:00–17:00) : présence
    // réduite à 08:00–15:00 → « Départ avancé » (ajustement, pas absence).
    vi.mocked(api.lirePlanning).mockResolvedValue({
      saisie: {
        absences: [
          {
            date: '2026-06-02',
            debutHeures: 15,
            debutMinutes: 0,
            finHeures: 17,
            finMinutes: 0,
            preavisJours: 0,
            certificatMaladie: false,
          },
        ],
      },
    });

    render(
      <CalendrierCreche
        contrat={contratCreche}
        mois="2026-06"
        simule={false}
        onEnregistre={vi.fn()}
      />,
    );

    await waitFor(() => {
      const ligne = screen.getByText('02/06/2026').closest('li');
      expect(ligne?.textContent).toContain('Départ avancé');
      expect(ligne?.textContent).not.toContain('Absent');
    });
  });

  it('classe une absence pleine journée en « Absent »', async () => {
    // Fenêtre 08:00–17:00 couvrant toute la garde MARDI → vraie absence.
    vi.mocked(api.lirePlanning).mockResolvedValue({
      saisie: {
        absences: [
          {
            date: '2026-06-02',
            debutHeures: 8,
            debutMinutes: 0,
            finHeures: 17,
            finMinutes: 0,
            preavisJours: 0,
            certificatMaladie: false,
          },
        ],
      },
    });

    render(
      <CalendrierCreche
        contrat={contratCreche}
        mois="2026-06"
        simule={false}
        onEnregistre={vi.fn()}
      />,
    );

    await waitFor(() => {
      const ligne = screen.getByText('02/06/2026').closest('li');
      expect(ligne?.textContent).toContain('Absent');
    });
  });

  it('ferme le dialog en cliquant sur Annuler', () => {
    render(
      <CalendrierCreche
        contrat={contratCreche}
        mois="2026-06"
        simule={false}
        onEnregistre={vi.fn()}
      />,
    );

    fireEvent.click(screen.getByTestId('simulate-date-click'));
    expect(screen.getByText(/Absence du 02\/06\/2026/i)).toBeInTheDocument();

    fireEvent.click(screen.getByText('Annuler'));
    expect(
      screen.queryByText(/Absence du 02\/06\/2026/i),
    ).not.toBeInTheDocument();
  });

  it('passe simule=true a ecrirePlanning en mode simulation', async () => {
    vi.mocked(api.ecrirePlanning).mockResolvedValue(undefined);

    render(
      <CalendrierCreche
        contrat={contratCreche}
        mois="2026-06"
        simule
        onEnregistre={vi.fn()}
      />,
    );

    fireEvent.click(screen.getByTestId('simulate-date-click'));
    fireEvent.click(screen.getByText('Confirmer'));

    await waitFor(
      () => {
        expect(api.ecrirePlanning).toHaveBeenCalledWith(
          'contrat-creche-1',
          '2026-06',
          true,
          expect.any(Object),
          expect.any(Object),
        );
      },
      { timeout: 2000 },
    );
  });

  // UT-07 CA1 : la saisie ne doit pas être perdue au changement de mois.
  it('ne perd pas les absences saisies lors d un aller-retour de mois', () => {
    const { rerender } = render(
      <CalendrierCreche
        contrat={contratCreche}
        mois="2026-06"
        simule={false}
        onEnregistre={vi.fn()}
      />,
    );

    // Saisir une absence le 02/06 (mardi gardé) via le clic de date simulé.
    fireEvent.click(screen.getByTestId('simulate-date-click'));
    fireEvent.click(screen.getByText('Confirmer'));
    // Dans la liste clavier, le 02/06 doit désormais être « Absent ».
    expect(screen.getByText('02/06/2026')).toBeInTheDocument();

    // Changer de mois (juillet), puis revenir en juin.
    rerender(
      <CalendrierCreche
        contrat={contratCreche}
        mois="2026-07"
        simule={false}
        onEnregistre={vi.fn()}
      />,
    );
    rerender(
      <CalendrierCreche
        contrat={contratCreche}
        mois="2026-06"
        simule={false}
        onEnregistre={vi.fn()}
      />,
    );

    // Le 02/06 est toujours marqué « Absent » : on rouvre sa saisie et la liste
    // propose « Modifier » (l'absence a été restaurée).
    const ligne = screen.getByText('02/06/2026').closest('li');
    expect(ligne).not.toBeNull();
    expect(ligne?.textContent).toContain('Absent');
  });

  // UT-07 CA1 : pas de fuite d'un mois vers un autre.
  it('n affiche pas les absences d un mois sur un autre mois', () => {
    const { rerender } = render(
      <CalendrierCreche
        contrat={contratCreche}
        mois="2026-06"
        simule={false}
        onEnregistre={vi.fn()}
      />,
    );

    fireEvent.click(screen.getByTestId('simulate-date-click'));
    fireEvent.click(screen.getByText('Confirmer'));
    const ligneJuin = screen.getByText('02/06/2026').closest('li');
    expect(ligneJuin?.textContent).toContain('Absent');

    // Juillet : le 02/07 (mardi gardé) ne doit pas hériter de l'absence de juin.
    rerender(
      <CalendrierCreche
        contrat={contratCreche}
        mois="2026-07"
        simule={false}
        onEnregistre={vi.fn()}
      />,
    );

    const ligneJuillet = screen.getByText('07/07/2026').closest('li');
    expect(ligneJuillet?.textContent).toContain('Gardé');
    expect(ligneJuillet?.textContent).not.toContain('Absent');
  });

  // UT-07 CA2/CA3 : saisie en lot accessible au clavier.
  it('applique une absence en lot a tous les jours gardes (saisie en lot)', () => {
    render(
      <CalendrierCreche
        contrat={contratCreche}
        mois="2026-06"
        simule={false}
        onEnregistre={vi.fn()}
      />,
    );

    // Avant : aucune ligne « Absent ».
    expect(screen.queryAllByText('Absent')).toHaveLength(0);

    // Bouton de saisie en lot, atteignable au clavier (vrai <button>).
    const boutonLot = screen.getByRole('button', {
      name: /Appliquer à tous les jours gardés/i,
    });
    fireEvent.click(boutonLot);

    // Tous les jours gardés du mois deviennent « Absent ».
    expect(screen.getAllByText('Absent').length).toBeGreaterThan(1);
  });

  // UT-07 CA2/CA3 : multi-sélection au clavier puis application en lot.
  it('applique une absence en lot a la multi-selection cochee', async () => {
    vi.mocked(api.ecrirePlanning).mockResolvedValue(undefined);

    render(
      <CalendrierCreche
        contrat={contratCreche}
        mois="2026-06"
        simule={false}
        onEnregistre={vi.fn()}
      />,
    );

    // Le bouton « Appliquer à la sélection » est désactivé tant que rien n'est coché.
    const boutonSelection = screen.getByRole('button', {
      name: /Appliquer à la sélection/i,
    });
    expect(boutonSelection).toBeDisabled();

    // Cocher deux jours via leurs cases (noms accessibles uniques).
    const caseLundi = screen.getByRole('checkbox', {
      name: /Sélectionner le 01\/06\/2026/i,
    });
    const caseMardi = screen.getByRole('checkbox', {
      name: /Sélectionner le 02\/06\/2026/i,
    });
    fireEvent.click(caseLundi);
    fireEvent.click(caseMardi);

    // Le compteur du bouton reflète la sélection et le bouton est actif.
    const boutonSelection2 = screen.getByRole('button', {
      name: /Appliquer à la sélection \(2\)/i,
    });
    expect(boutonSelection2).not.toBeDisabled();
    fireEvent.click(boutonSelection2);

    // Les deux jours sélectionnés deviennent « Absent ».
    const ligneLundi = screen.getByText('01/06/2026').closest('li');
    const ligneMardi = screen.getByText('02/06/2026').closest('li');
    expect(ligneLundi?.textContent).toContain('Absent');
    expect(ligneMardi?.textContent).toContain('Absent');

    // L'application en lot déclenche bien l'écriture serveur (debounce 800 ms).
    await waitFor(
      () => {
        expect(api.ecrirePlanning).toHaveBeenCalledWith(
          'contrat-creche-1',
          '2026-06',
          false,
          expect.objectContaining({ absences: expect.any(Array) }),
          expect.any(Object),
        );
      },
      { timeout: 2000 },
    );
  });

  // Invariant MBT : un échec de modification durable (429 / réseau) ne doit JAMAIS
  // détruire l'état — on affiche une erreur et le contrat reste en place.
  it('modif durable en echec (429) : affiche une erreur sans detruire l etat', async () => {
    vi.mocked(api.modifierContrat).mockRejectedValue(
      new ApiError(429, 'trop de requêtes'),
    );

    render(
      <CalendrierCreche
        contrat={contratCreche}
        mois="2026-06"
        simule={false}
        onEnregistre={vi.fn()}
        onContratModifie={vi.fn()}
      />,
    );

    // Ouvre la saisie d'un jour gardé (mardi) ; le choix de portée est dans le dialog.
    fireEvent.click(screen.getByTestId('simulate-date-click'));
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

// AQ-05 : chaque mutation du calendrier (absence, jour supplémentaire, lot) est
// annoncée dans une région live (`role="status"`, polite) pour les lecteurs
// d'écran — la sauvegarde étant différée (debounce 800 ms), le retour visuel
// seul ne suffit pas.
describe('CalendrierCreche - annonces aria-live (AQ-05)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    sessionStorage.clear();
    vi.mocked(api.lirePlanning).mockResolvedValue({ saisie: null });
  });

  function rendre() {
    return render(
      <CalendrierCreche
        contrat={contratCreche}
        mois="2026-06"
        simule={false}
        onEnregistre={vi.fn()}
      />,
    );
  }

  it('expose une région live polite de rôle status', () => {
    const { container } = rendre();
    const region = container.querySelector('p.sr-only[aria-live="polite"]');
    expect(region).not.toBeNull();
    expect(region).toHaveAttribute('role', 'status');
  });

  it("annonce l'ajout d'une absence confirmée", () => {
    rendre();
    fireEvent.click(screen.getByTestId('simulate-date-click'));
    fireEvent.click(screen.getByText('Confirmer'));

    expect(
      screen.getByText(/Absence ajoutée le 02\/06\/2026/),
    ).toBeInTheDocument();
  });

  it("annonce le retrait d'une absence supprimée", () => {
    rendre();
    // Ajoute l'absence puis rouvre le jour : le bouton « Supprimer » apparaît.
    fireEvent.click(screen.getByTestId('simulate-date-click'));
    fireEvent.click(screen.getByText('Confirmer'));
    fireEvent.click(screen.getByTestId('simulate-date-click'));
    fireEvent.click(screen.getByText('Supprimer'));

    expect(
      screen.getByText(/Absence retirée le 02\/06\/2026/),
    ).toBeInTheDocument();
  });

  it("annonce l'ajout d'un jour supplémentaire", () => {
    rendre();
    fireEvent.click(screen.getByTestId('simulate-date-click-libre'));
    fireEvent.click(screen.getByText('Confirmer'));

    expect(
      screen.getByText(/Jour supplémentaire ajouté le 06\/06\/2026/),
    ).toBeInTheDocument();
  });

  it("annonce l'application d'un lot avec le nombre de jours", () => {
    rendre();
    fireEvent.click(
      screen.getByRole('button', {
        name: /Appliquer à tous les jours gardés/i,
      }),
    );

    expect(
      screen.getByText(/Absences ajoutées sur \d+ jours/),
    ).toBeInTheDocument();
  });
});

// AQ-12 : l'échec de persistance locale (quota sessionStorage) est signalé par
// un bandeau discret au lieu d'être avalé en silence.
describe('CalendrierCreche - persistance locale indisponible (AQ-12)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    sessionStorage.clear();
    vi.mocked(api.lirePlanning).mockResolvedValue({ saisie: null });
  });

  it('affiche un bandeau quand sessionStorage refuse l écriture, sans bloquer la saisie', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const setItem = vi
      .spyOn(Storage.prototype, 'setItem')
      .mockImplementation(() => {
        throw new DOMException('quota dépassé', 'QuotaExceededError');
      });

    try {
      render(
        <CalendrierCreche
          contrat={contratCreche}
          mois="2026-06"
          simule={false}
          onEnregistre={vi.fn()}
        />,
      );

      expect(
        screen.queryByText(/Mémorisation locale indisponible/),
      ).not.toBeInTheDocument();

      // La saisie aboutit malgré l'échec de persistance…
      fireEvent.click(screen.getByTestId('simulate-date-click'));
      fireEvent.click(screen.getByText('Confirmer'));
      const ligne = screen.getByText('02/06/2026').closest('li');
      expect(ligne?.textContent).toContain('Absent');

      // … et l'indisponibilité est signalée (bandeau + warning console).
      expect(
        screen.getByText(/Mémorisation locale indisponible/),
      ).toBeInTheDocument();
      expect(warn).toHaveBeenCalled();
    } finally {
      setItem.mockRestore();
      warn.mockRestore();
    }
  });
});
