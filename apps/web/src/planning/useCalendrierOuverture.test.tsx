import { describe, expect, it, vi, beforeEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { useCalendrierOuverture } from './useCalendrierOuverture';
import { viderCacheAsync } from '../hooks/useAsync';
import { api } from '../api/client';
import type { CalendrierResoluVue } from '../types/bff';

vi.mock('../api/client', () => ({
  api: { lireCalendrierResolu: vi.fn() },
}));

const lire = vi.mocked(api.lireCalendrierResolu);

const FOYER = '11111111-1111-4111-8111-111111111111';
const ETAB = '22222222-2222-4222-8222-222222222222';
const MOIS = '2026-11';

/** Un jour résolu, forme du contrat gelé du lot 2. */
function jour(
  iso: string,
  contexte: 'PERIODE_SCOLAIRE' | 'VACANCES' | 'FERIE' | 'FERMETURE',
  servicesOuverts: ('CRECHE_PSU' | 'CANTINE' | 'PERISCOLAIRE' | 'ALSH')[],
  libelle = '',
) {
  return { jour: iso, contexte, libelle, servicesOuverts };
}

function reponse(jours: ReturnType<typeof jour>[]): CalendrierResoluVue {
  return {
    du: '2026-11-01',
    au: '2026-11-30',
    aLaDate: '2026-11-01T00:00:00.000Z',
    jours,
  } as CalendrierResoluVue;
}

function monter() {
  return renderHook(() => useCalendrierOuverture(FOYER, ETAB, MOIS));
}

beforeEach(() => {
  viderCacheAsync();
  lire.mockReset();
});

/**
 * **Le cœur du lot : la garde doit mordre dans les DEUX sens.**
 *
 * Une garde trop LARGE bloque un jour légitime — et c'est le pire des deux, parce
 * qu'elle est silencieuse pour qui code et bloquante pour le parent. Une garde
 * trop ÉTROITE laisse saisir un jour fermé, que la génération des prestations
 * refusera ensuite : gênant, mais visible et rattrapable.
 *
 * Chaque test ci-dessous a donc son symétrique. Un seul des deux passerait avec
 * une implémentation qui rend toujours la même réponse.
 */
describe('useCalendrierOuverture — la garde mord dans les deux sens', () => {
  it('FERME un service que le calendrier n’ouvre pas ce jour-là', async () => {
    lire.mockResolvedValue(
      reponse([
        jour('2026-11-02', 'PERIODE_SCOLAIRE', ['CANTINE', 'PERISCOLAIRE']),
        jour('2026-11-04', 'PERIODE_SCOLAIRE', ['ALSH']),
      ]),
    );
    const { result } = monter();
    await waitFor(() => expect(result.current.jours).toHaveLength(2));

    // Le mercredi n'ouvre que l'ALSH : la cantine y est fermée (CA1).
    expect(result.current.serviceOuvert('2026-11-04', 'CANTINE')).toBe(false);
    expect(result.current.serviceOuvert('2026-11-04', 'ALSH')).toBe(true);
  });

  it('LAISSE OUVERT un service que le calendrier ouvre — la contre-épreuve', async () => {
    lire.mockResolvedValue(
      reponse([
        jour('2026-11-02', 'PERIODE_SCOLAIRE', ['CANTINE', 'PERISCOLAIRE']),
      ]),
    );
    const { result } = monter();
    await waitFor(() => expect(result.current.jours).toHaveLength(1));

    expect(result.current.serviceOuvert('2026-11-02', 'CANTINE')).toBe(true);
    expect(result.current.motifFermeture('2026-11-02', 'CANTINE')).toBeNull();
  });

  /**
   * **La garde trop large — le défaut que ce test existe pour empêcher.**
   *
   * Un établissement sans semaine type saisie rend des jours à `servicesOuverts`
   * vide, exactement comme un établissement fermé. Les confondre rendrait TOUT le
   * planning non saisissable, en silence, pour tous les contrats. C'est le
   * pendant web de `LE-103`, qui a été trouvé côté facturation au lot 4.
   */
  it('ne restreint RIEN quand aucun jour du mois n’ouvre quoi que ce soit', async () => {
    lire.mockResolvedValue(
      reponse([
        jour('2026-11-02', 'PERIODE_SCOLAIRE', []),
        jour('2026-11-03', 'PERIODE_SCOLAIRE', []),
      ]),
    );
    const { result } = monter();
    await waitFor(() => expect(result.current.jours).toHaveLength(2));

    expect(result.current.serviceOuvert('2026-11-02', 'CRECHE_PSU')).toBe(true);
    expect(
      result.current.motifFermeture('2026-11-02', 'CRECHE_PSU'),
    ).toBeNull();
  });

  it('reprend autorité dès qu’UN seul jour ouvre UN seul service', async () => {
    lire.mockResolvedValue(
      reponse([
        jour('2026-11-02', 'PERIODE_SCOLAIRE', ['CRECHE_PSU']),
        jour('2026-11-03', 'FERMETURE', [], 'Fermeture annuelle'),
      ]),
    );
    const { result } = monter();
    await waitFor(() => expect(result.current.jours).toHaveLength(2));

    // Sans cette contre-épreuve, la garde ci-dessus pourrait tout ouvrir
    // pour toujours et les deux tests passeraient pour la mauvaise raison.
    expect(result.current.serviceOuvert('2026-11-02', 'CRECHE_PSU')).toBe(true);
    expect(result.current.serviceOuvert('2026-11-03', 'CRECHE_PSU')).toBe(
      false,
    );
  });

  it('ne restreint rien tant que le calendrier n’est pas chargé', () => {
    lire.mockReturnValue(new Promise(() => undefined));
    const { result } = monter();

    expect(result.current.chargement).toBe(true);
    expect(result.current.serviceOuvert('2026-11-02', 'CRECHE_PSU')).toBe(true);
  });

  it('ne restreint rien quand la lecture échoue', async () => {
    lire.mockRejectedValue(new Error('réseau'));
    const { result } = monter();
    // On attend que la lecture ait été TENTÉE puis rejetée, sans s'accrocher au
    // drapeau de chargement : ce qui est affirmé ici, c'est l'absence de
    // restriction, pas le cycle de vie du hook de chargement.
    await waitFor(() => expect(lire).toHaveBeenCalled());
    await waitFor(() => expect(result.current.jours).toHaveLength(0));

    // Un calendrier injoignable ne doit pas bloquer la saisie : c'est la même
    // règle que « inconnu ≠ fermé », appliquée à une panne.
    expect(result.current.serviceOuvert('2026-11-02', 'CRECHE_PSU')).toBe(true);
    expect(
      result.current.motifFermeture('2026-11-02', 'CRECHE_PSU'),
    ).toBeNull();
  });

  it('ne restreint pas un jour hors de la plage chargée', async () => {
    lire.mockResolvedValue(
      reponse([jour('2026-11-02', 'PERIODE_SCOLAIRE', ['CRECHE_PSU'])]),
    );
    const { result } = monter();
    await waitFor(() => expect(result.current.jours).toHaveLength(1));

    // Un jour qu'on n'a pas demandé n'est pas un jour fermé.
    expect(result.current.serviceOuvert('2027-03-15', 'CRECHE_PSU')).toBe(true);
  });

  it('ne lit rien, et n’empêche rien, sans établissement', async () => {
    const { result } = renderHook(() =>
      useCalendrierOuverture(FOYER, null, MOIS),
    );
    await waitFor(() => expect(result.current.chargement).toBe(false));

    expect(lire).not.toHaveBeenCalled();
    expect(result.current.serviceOuvert('2026-11-02', 'CRECHE_PSU')).toBe(true);
  });
});

describe('useCalendrierOuverture — le motif, pas seulement le refus', () => {
  it('rend le libellé du calendrier quand il y en a un', async () => {
    lire.mockResolvedValue(
      reponse([
        jour('2026-11-02', 'PERIODE_SCOLAIRE', ['CANTINE']),
        jour('2026-11-03', 'VACANCES', ['ALSH'], 'Vacances de la Toussaint'),
      ]),
    );
    const { result } = monter();
    await waitFor(() => expect(result.current.jours).toHaveLength(2));

    expect(result.current.motifFermeture('2026-11-03', 'CANTINE')).toBe(
      'Vacances de la Toussaint',
    );
  });

  it('retombe sur le contexte quand le calendrier ne nomme pas le jour', async () => {
    lire.mockResolvedValue(
      reponse([
        jour('2026-11-02', 'PERIODE_SCOLAIRE', ['CANTINE']),
        jour('2026-11-11', 'FERIE', []),
      ]),
    );
    const { result } = monter();
    await waitFor(() => expect(result.current.jours).toHaveLength(2));

    // CA3 : un refus muet est indiscernable d'une panne — il faut un motif,
    // même quand la donnée n'en fournit pas de joli.
    expect(result.current.motifFermeture('2026-11-11', 'CANTINE')).toBe(
      'jour férié',
    );
  });
});
