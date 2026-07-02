import { describe, it, expect } from 'vitest';
import { initBesoins, versCorps, type BesoinsEtat } from './besoinsSemaine';
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
