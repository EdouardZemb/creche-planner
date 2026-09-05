import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { CalendrierPage } from './CalendrierPage';
import { api, ApiError } from '../api/client';

/**
 * Écran « Calendrier » (SFD 31, lot 3). Ce que ces tests protègent :
 *
 * 1. **CA3** — quand l'open data tombe, l'écran ne se casse pas : il dit ce qui
 *    a échoué ET reste utilisable en saisie manuelle. Un écran qui se vide sur
 *    une panne d'API tierce transformerait une gêne en blocage.
 * 2. **CA2 rendue LISIBLE** — le badge « importé »/« saisi » n'est pas décoratif :
 *    c'est la seule chose qui dit au parent ce qu'un réimport emportera.
 * 3. **La zone commande l'import** — sans zone, le bouton est inerte et l'écran
 *    dit pourquoi, plutôt que de laisser partir un appel voué au 422.
 */

vi.mock('../api/client', async () => {
  const reel = await vi.importActual<typeof import('../api/client')>(
    '../api/client',
  );
  return {
    ...reel,
    api: {
      listerEtablissements: vi.fn(),
      lirePeriodesCalendrier: vi.fn(),
      lireExceptionsCalendrier: vi.fn(),
      lireRecurrencesCalendrier: vi.fn(),
      importerCalendrier: vi.fn(),
      poserExceptionCalendrier: vi.fn(),
      cloreExceptionCalendrier: vi.fn(),
      modifierEtablissement: vi.fn(),
    },
  };
});

const FOYER = '11111111-1111-4111-8111-111111111111';
const ETAB = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';

const mocked = api as unknown as Record<string, ReturnType<typeof vi.fn>>;

/** Accès typé au mock : `noUncheckedIndexedAccess` rend l'indexation optionnelle. */
function m(nom: string): ReturnType<typeof vi.fn> {
  const espion = mocked[nom];
  if (espion === undefined) throw new Error(`mock absent : ${nom}`);
  return espion;
}

function etablissement(zoneScolaire: string | null = 'B') {
  return {
    id: ETAB,
    nom: 'École du Centre',
    actif: true,
    zoneScolaire,
    adresse: null,
    telephone: null,
    contact: null,
    emailService: null,
    preavisRegle: null,
  };
}

function armer({
  zone = 'B' as string | null,
  periodes = [] as unknown[],
  exceptions = [] as unknown[],
} = {}) {
  m('listerEtablissements').mockResolvedValue([etablissement(zone)]);
  m('lirePeriodesCalendrier').mockResolvedValue({
    aLaDate: '2026-06-01T00:00:00.000Z',
    periodes,
  });
  m('lireExceptionsCalendrier').mockResolvedValue({
    aLaDate: '2026-06-01T00:00:00.000Z',
    exceptions,
  });
  m('lireRecurrencesCalendrier').mockResolvedValue({
    aLaDate: '2026-06-01T00:00:00.000Z',
    recurrences: [],
  });
}

function rendre() {
  return render(
    <MemoryRouter
      initialEntries={[`/foyers/${FOYER}/etablissements/${ETAB}/calendrier`]}
    >
      <Routes>
        <Route
          path="/foyers/:foyerId/etablissements/:etabId/calendrier"
          element={<CalendrierPage />}
        />
      </Routes>
    </MemoryRouter>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('CalendrierPage', () => {
  it('affiche les périodes et distingue l’importé du saisi', async () => {
    armer({
      periodes: [
        {
          id: 'p1',
          type: 'VACANCES',
          libelle: 'Vacances de la Toussaint',
          du: '2026-10-17',
          au: '2026-11-01',
          source: 'IMPORT',
        },
        {
          id: 'p2',
          type: 'FERMETURE_ANNUELLE',
          libelle: 'Fermeture d’été de la crèche',
          du: '2027-08-01',
          au: '2027-08-15',
          source: 'MANUEL',
        },
      ],
    });
    rendre();

    expect(
      await screen.findByText('Vacances de la Toussaint'),
    ).toBeInTheDocument();
    // Les dates sont affichées en calendaire local, sans reformatage par fuseau :
    // `2026-10-17` est un jour, pas un instant.
    expect(screen.getByText(/17\/10\/2026/)).toBeInTheDocument();
    expect(screen.getByText('importé')).toBeInTheDocument();
    expect(screen.getByText('saisi')).toBeInTheDocument();
  });

  it('importe l’année et annonce ce qui a été posé', async () => {
    armer();
    m('importerCalendrier').mockResolvedValue({
      anneeScolaire: '2026-2027',
      zoneScolaire: 'B',
      importees: 5,
      remplacees: 0,
    });
    rendre();

    const bouton = await screen.findByRole('button', {
      name: /Importer l’année 2026-2027/,
    });
    await userEvent.click(bouton);

    await waitFor(() => {
      expect(m('importerCalendrier')).toHaveBeenCalledWith(
        FOYER,
        ETAB,
        '2026-2027',
      );
    });
    expect(await screen.findByRole('status')).toHaveTextContent(
      /5 périodes importées/,
    );
  });

  it('dit « rafraîchies » et rassure sur les saisies au RÉIMPORT', async () => {
    armer();
    m('importerCalendrier').mockResolvedValue({
      anneeScolaire: '2026-2027',
      zoneScolaire: 'B',
      importees: 5,
      remplacees: 5,
    });
    rendre();

    await userEvent.click(
      await screen.findByRole('button', { name: /Importer l’année/ }),
    );

    // CA2 vue du parent : il doit SAVOIR que ses retouches survivent, sinon il
    // n'osera pas réimporter — et le calendrier se périmera tout seul.
    expect(await screen.findByRole('status')).toHaveTextContent(
      /rafraîchies.*saisies sont intactes/,
    );
  });

  it('reste utilisable quand l’open data tombe (CA3)', async () => {
    armer();
    m('importerCalendrier').mockRejectedValue(
      new ApiError(422, {
        code: 'IMPORT_CALENDRIER_INDISPONIBLE',
        message: 'calendrier scolaire injoignable',
      }),
    );
    rendre();

    await userEvent.click(
      await screen.findByRole('button', { name: /Importer l’année/ }),
    );

    expect(await screen.findByRole('alert')).toBeInTheDocument();
    // Le formulaire de saisie manuelle est TOUJOURS là : c'est tout l'objet de
    // CA3. Un écran qui se viderait sur l'échec ferait d'une panne tierce une
    // panne produit.
    expect(screen.getByLabelText('Jour')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Ajouter' })).toBeInTheDocument();
  });

  it('n’autorise pas l’import sans zone, et dit pourquoi', async () => {
    armer({ zone: null });
    rendre();

    const bouton = await screen.findByRole('button', {
      name: /Importer l’année/,
    });
    expect(bouton).toBeDisabled();
    expect(screen.getByText(/Choisissez d’abord une zone/)).toBeInTheDocument();
    expect(m('importerCalendrier')).not.toHaveBeenCalled();
  });

  it('ajoute une journée particulière', async () => {
    armer();
    m('poserExceptionCalendrier').mockResolvedValue({ id: 'e1' });
    rendre();

    await userEvent.type(await screen.findByLabelText('Jour'), '2027-03-13');
    await userEvent.type(screen.getByLabelText('Intitulé'), 'Journée péda');
    await userEvent.click(screen.getByRole('button', { name: 'Ajouter' }));

    await waitFor(() => {
      expect(m('poserExceptionCalendrier')).toHaveBeenCalledWith(
        FOYER,
        ETAB,
        expect.objectContaining({
          jour: '2027-03-13',
          type: 'JOURNEE_PEDAGOGIQUE',
          libelle: 'Journée péda',
        }),
      );
    });
  });

  it('parle de « retirer », jamais de suppression définitive', async () => {
    armer({
      exceptions: [
        {
          id: 'e1',
          jour: '2027-03-13',
          type: 'JOURNEE_PEDAGOGIQUE',
          libelle: 'Journée pédagogique',
        },
      ],
    });
    m('cloreExceptionCalendrier').mockResolvedValue(undefined);
    rendre();

    await userEvent.click(
      await screen.findByRole('button', { name: 'Retirer' }),
    );

    await waitFor(() => {
      expect(m('cloreExceptionCalendrier')).toHaveBeenCalledWith(
        FOYER,
        ETAB,
        'e1',
      );
    });
    // Le mot dit ce qui se passe : la ligne est CLOSE, elle reste lisible à un
    // instant antérieur. « Supprimé définitivement » serait faux.
    expect(await screen.findByRole('status')).toHaveTextContent(
      /reste lisible dans l’historique/,
    );
  });
});
