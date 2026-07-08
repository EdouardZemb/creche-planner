import { describe, it, expect } from 'vitest';
import {
  alshEffectif,
  initBesoins,
  libelleAlsh,
  versCorps,
  type BesoinsEtat,
} from './besoinsSemaine';
import type { ContratBesoinsSemaine } from '../types/bff';

// Contrat minimal : seuls `besoins` importe pour l'aplatissement.
function contratAvec(
  besoins: ContratBesoinsSemaine['besoins'],
): ContratBesoinsSemaine {
  return {
    contratId: 'c-1',
    enfant: 'Léa',
    mode: 'CRECHE_PSU',
    etablissementId: null,
    besoins,
  };
}

const ETAT_VIDE: BesoinsEtat = {
  absences: [],
  joursSup: [],
  ajustements: [],
  exceptions: [],
  joursAlsh: [],
};

describe('initBesoins', () => {
  it('aplatit les besoins datés par catégorie sur toute la semaine', () => {
    const etat = initBesoins(
      contratAvec({
        '2026-06-29': {
          absences: [
            {
              date: '2026-06-29',
              debutHeures: 9,
              debutMinutes: 0,
              finHeures: 16,
              finMinutes: 30,
              preavisJours: 2,
              certificatMaladie: true,
            },
          ],
          joursSupplementaires: [],
          ajustements: [],
          exceptions: [{ date: '2026-06-29', cantine: true }],
          joursAlsh: [],
        },
        '2026-06-30': {
          absences: [],
          joursSupplementaires: [
            {
              date: '2026-06-30',
              debutHeures: 8,
              debutMinutes: 30,
              finHeures: 17,
              finMinutes: 0,
            },
          ],
          ajustements: [
            {
              date: '2026-06-30',
              debutHeures: 8,
              debutMinutes: 0,
              finHeures: 16,
              finMinutes: 30,
              preavisJours: 1,
              certificatMaladie: false,
            },
          ],
          exceptions: [],
          joursAlsh: [{ date: '2026-06-30', type: 'COMPLETE', repas: true }],
        },
      }),
    );

    expect(etat.absences).toEqual([
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
    expect(etat.joursSup).toEqual([
      {
        date: '2026-06-30',
        debutHeures: 8,
        debutMinutes: 30,
        finHeures: 17,
        finMinutes: 0,
      },
    ]);
    expect(etat.ajustements).toEqual([
      {
        date: '2026-06-30',
        debutHeures: 8,
        debutMinutes: 0,
        finHeures: 16,
        finMinutes: 30,
        preavisJours: 1,
        certificatMaladie: false,
      },
    ]);
    expect(etat.exceptions).toEqual([{ date: '2026-06-29', cantine: true }]);
    expect(etat.joursAlsh).toEqual([
      { date: '2026-06-30', type: 'COMPLETE', repas: true },
    ]);
  });

  it('ignore une absence sans date (métadonnée d’affichage absente)', () => {
    const etat = initBesoins(
      contratAvec({
        '2026-06-29': {
          absences: [
            {
              debutHeures: 9,
              debutMinutes: 0,
              finHeures: 16,
              finMinutes: 30,
              preavisJours: 0,
              certificatMaladie: false,
            },
          ],
          joursSupplementaires: [],
          ajustements: [],
          exceptions: [],
          joursAlsh: [],
        },
      }),
    );
    expect(etat.absences).toEqual([]);
  });

  it('normalise le repas ALSH absent en `false`', () => {
    const etat = initBesoins(
      contratAvec({
        '2026-07-01': {
          absences: [],
          joursSupplementaires: [],
          ajustements: [],
          exceptions: [],
          joursAlsh: [{ date: '2026-07-01', type: 'DEMI' }],
        },
      }),
    );
    expect(etat.joursAlsh).toEqual([
      { date: '2026-07-01', type: 'DEMI', repas: false },
    ]);
  });

  it('rend des listes vides pour un contrat sans besoins datés', () => {
    expect(initBesoins(contratAvec({}))).toEqual(ETAT_VIDE);
  });
});

describe('versCorps', () => {
  it('omet toutes les catégories vides (corps vide)', () => {
    expect(versCorps(ETAT_VIDE)).toEqual({});
  });

  it('reconstruit uniquement les catégories non vides', () => {
    const corps = versCorps({
      ...ETAT_VIDE,
      absences: [
        {
          date: '2026-06-29',
          debutHeures: 9,
          debutMinutes: 0,
          finHeures: 16,
          finMinutes: 30,
          preavisJours: 1,
          certificatMaladie: false,
        },
      ],
      exceptions: [{ date: '2026-06-30', periMatin: true, periSoir: false }],
    });

    expect(corps).toEqual({
      absences: [
        {
          date: '2026-06-29',
          debutHeures: 9,
          debutMinutes: 0,
          finHeures: 16,
          finMinutes: 30,
          preavisJours: 1,
          certificatMaladie: false,
        },
      ],
      exceptions: [{ date: '2026-06-30', periMatin: true, periSoir: false }],
    });
    expect(corps.joursSupplementaires).toBeUndefined();
    expect(corps.joursAlsh).toBeUndefined();
  });

  it('reconstruit la catégorie `ajustements` (heures réelles) quand elle est non vide', () => {
    const corps = versCorps({
      ...ETAT_VIDE,
      ajustements: [
        {
          date: '2026-06-30',
          debutHeures: 8,
          debutMinutes: 0,
          finHeures: 16,
          finMinutes: 30,
          preavisJours: 2,
          certificatMaladie: true,
        },
      ],
    });
    expect(corps.ajustements).toEqual([
      {
        date: '2026-06-30',
        debutHeures: 8,
        debutMinutes: 0,
        finHeures: 16,
        finMinutes: 30,
        preavisJours: 2,
        certificatMaladie: true,
      },
    ]);
    expect(corps.absences).toBeUndefined();
  });

  it('n’émet `repas` que lorsqu’il est vrai (parcimonie du corps ALSH)', () => {
    const corps = versCorps({
      ...ETAT_VIDE,
      joursAlsh: [
        { date: '2026-07-01', type: 'DEMI', repas: false },
        { date: '2026-07-02', type: 'COMPLETE', repas: true },
      ],
    });
    expect(corps.joursAlsh).toEqual([
      { date: '2026-07-01', type: 'DEMI' },
      { date: '2026-07-02', type: 'COMPLETE', repas: true },
    ]);
  });
});

describe('alshEffectif', () => {
  // 2026-07-01 = mercredi (récurrence testée sur MERCREDI).
  const MERCREDI = '2026-07-01';

  it('un jour explicite prime sur récurrence et exception', () => {
    expect(
      alshEffectif(
        MERCREDI,
        { type: 'DEMI' },
        { date: MERCREDI, alsh: false },
        { MERCREDI: { alsh: { type: 'COMPLETE', repas: true } } },
      ),
    ).toEqual({ type: 'DEMI' });
  });

  it('à défaut d’explicite, retombe sur la récurrence hebdomadaire', () => {
    expect(
      alshEffectif(MERCREDI, undefined, undefined, {
        MERCREDI: { alsh: { type: 'COMPLETE', repas: true } },
      }),
    ).toEqual({ type: 'COMPLETE', repas: true });
  });

  it('une exception `alsh:false` retire le jour récurrent', () => {
    expect(
      alshEffectif(
        MERCREDI,
        undefined,
        { date: MERCREDI, alsh: false },
        { MERCREDI: { alsh: { type: 'COMPLETE' } } },
      ),
    ).toBeNull();
  });

  it('une exception `alsh:true` (ré)active avec la config récurrente si présente', () => {
    expect(
      alshEffectif(
        MERCREDI,
        undefined,
        { date: MERCREDI, alsh: true },
        { MERCREDI: { alsh: { type: 'DEMI' } } },
      ),
    ).toEqual({ type: 'DEMI' });
  });

  it('une exception `alsh:true` sans récurrence pose une journée complète par défaut', () => {
    expect(
      alshEffectif(MERCREDI, undefined, { date: MERCREDI, alsh: true }, {}),
    ).toEqual({ type: 'COMPLETE' });
  });

  it('rend `null` pour un jour ni explicite ni récurrent ni exception', () => {
    expect(alshEffectif(MERCREDI, undefined, undefined, {})).toBeNull();
  });
});

describe('libelleAlsh', () => {
  it('formate les trois états de journée', () => {
    expect(libelleAlsh({ type: 'DEMI' })).toBe('Demi-journée');
    expect(libelleAlsh({ type: 'COMPLETE' })).toBe('Journée');
    expect(libelleAlsh({ type: 'COMPLETE', repas: true })).toBe(
      'Journée + repas',
    );
  });
});
