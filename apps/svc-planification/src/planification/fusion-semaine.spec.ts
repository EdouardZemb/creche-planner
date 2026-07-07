import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { joursDeLaSemaine } from '@creche-planner/shared-semaine';
import {
  fusionnerSemaineDansMois,
  type BesoinsSemaine,
} from './fusion-semaine.js';
import type { EcrirePlanningDto } from './planification.dto.js';

/**
 * Tests de la fusion **pure** d'une édition hebdomadaire dans la saisie d'un mois.
 * Oracles (mono-mois, à cheval 2 mois, préservation, suppression, idempotence) +
 * propriétés (fast-check) sur les invariants : scalaires intacts, jours hors
 * semaine préservés, entrées des jours de la semaine = exactement les besoins.
 */

/** Jour supplémentaire daté (forme `EcrirePlanningDto`). */
function jourSup(
  date: string,
  debutHeures = 9,
): NonNullable<EcrirePlanningDto['joursSupplementaires']> {
  return [{ date, debutHeures, debutMinutes: 0, finHeures: 12, finMinutes: 0 }];
}

describe('fusionnerSemaineDansMois — oracles', () => {
  it('semaine mono-mois : remplace les jours de la semaine, garde le reste du mois', () => {
    const jours = joursDeLaSemaine('2026-W11'); // tout mars 2026 (09 → 15).
    const saisieMois: EcrirePlanningDto = {
      complementMinutes: 60,
      joursSupplementaires: [
        ...jourSup('2026-03-02'), // hors semaine (à conserver)
        ...jourSup('2026-03-10', 8), // dans la semaine (à remplacer)
        ...jourSup('2026-03-25'), // hors semaine (à conserver)
      ],
    };
    const besoins: BesoinsSemaine = {
      joursSupplementaires: jourSup('2026-03-12', 7), // nouveau jour de la semaine
    };

    const fusion = fusionnerSemaineDansMois(saisieMois, jours, besoins);

    // Scalaire mensuel intact.
    expect(fusion.complementMinutes).toBe(60);
    const dates = (fusion.joursSupplementaires ?? []).map((j) => j.date).sort();
    // 03-10 (dans la semaine) retiré ; 03-12 (besoin) ajouté ; 03-02 / 03-25 gardés.
    expect(dates).toEqual(['2026-03-02', '2026-03-12', '2026-03-25']);
  });

  it('semaine à cheval 2 mois : un appel ne traite que les jours de SON mois', () => {
    const tousLesJours = joursDeLaSemaine('2026-W14'); // 03-30,03-31 | 04-01..04-05
    const joursMars = tousLesJours.filter((j) => j.startsWith('2026-03'));
    const saisieMars: EcrirePlanningDto = {
      joursSupplementaires: [
        ...jourSup('2026-03-15'), // hors semaine
        ...jourSup('2026-03-30'), // dans la semaine (mars), à remplacer
      ],
    };
    // Besoins de TOUTE la semaine, dont des jours d'avril : ne doivent PAS entrer en mars.
    const besoins: BesoinsSemaine = {
      joursSupplementaires: [
        ...jourSup('2026-03-31'),
        ...jourSup('2026-04-02'),
      ],
    };

    const fusion = fusionnerSemaineDansMois(saisieMars, joursMars, besoins);

    const dates = (fusion.joursSupplementaires ?? []).map((j) => j.date).sort();
    // 03-15 gardé, 03-30 retiré, 03-31 ajouté ; 04-02 ignoré (autre mois).
    expect(dates).toEqual(['2026-03-15', '2026-03-31']);
  });

  it('suppression : besoins vides retirent les jours de la semaine du mois', () => {
    const jours = joursDeLaSemaine('2026-W11');
    const saisieMois: EcrirePlanningDto = {
      pai: true,
      exceptions: [
        { date: '2026-03-10', cantine: true }, // dans la semaine
        { date: '2026-03-23', cantine: true }, // hors semaine
      ],
    };
    const fusion = fusionnerSemaineDansMois(saisieMois, jours, {});

    expect(fusion.pai).toBe(true); // scalaire intact
    expect(fusion.exceptions).toEqual([{ date: '2026-03-23', cantine: true }]);
  });

  it('forme canonique : une catégorie qui devient vide est omise (pas `[]`)', () => {
    const jours = joursDeLaSemaine('2026-W11');
    const saisieMois: EcrirePlanningDto = {
      joursSupplementaires: jourSup('2026-03-10'),
    };
    const fusion = fusionnerSemaineDansMois(saisieMois, jours, {});
    expect('joursSupplementaires' in fusion).toBe(false);
  });

  it('mois vide + besoins : insère uniquement les besoins de la fenêtre', () => {
    const jours = joursDeLaSemaine('2026-W11');
    const besoins: BesoinsSemaine = {
      absences: [
        {
          date: '2026-03-11',
          debutHeures: 8,
          debutMinutes: 30,
          finHeures: 12,
          finMinutes: 0,
          preavisJours: 3,
          certificatMaladie: false,
        },
      ],
    };
    const fusion = fusionnerSemaineDansMois(null, jours, besoins);
    expect(fusion.absences).toHaveLength(1);
    expect(fusion.absences?.[0]?.date).toBe('2026-03-11');
  });

  it('fusionne la catégorie ajustements comme les autres entrées datées', () => {
    const jours = joursDeLaSemaine('2026-W11'); // tout mars 2026.
    const ajustement = (date: string) => ({
      date,
      debutHeures: 8,
      debutMinutes: 0,
      finHeures: 16,
      finMinutes: 30,
      preavisJours: 2,
      certificatMaladie: false,
    });
    const saisieMois: EcrirePlanningDto = {
      ajustements: [ajustement('2026-03-02'), ajustement('2026-03-10')], // hors / dans semaine
    };
    const besoins: BesoinsSemaine = {
      ajustements: [ajustement('2026-03-12')], // nouvel ajustement de la semaine
    };

    const fusion = fusionnerSemaineDansMois(saisieMois, jours, besoins);

    const dates = (fusion.ajustements ?? []).map((a) => a.date).sort();
    // 03-10 (dans la semaine) retiré ; 03-12 ajouté ; 03-02 (hors semaine) gardé.
    expect(dates).toEqual(['2026-03-02', '2026-03-12']);
  });

  it('forme canonique : la catégorie ajustements devenue vide est omise', () => {
    const jours = joursDeLaSemaine('2026-W11');
    const saisieMois: EcrirePlanningDto = {
      ajustements: [
        {
          date: '2026-03-10',
          debutHeures: 8,
          debutMinutes: 0,
          finHeures: 16,
          finMinutes: 30,
          preavisJours: 0,
          certificatMaladie: false,
        },
      ],
    };
    const fusion = fusionnerSemaineDansMois(saisieMois, jours, {});
    expect('ajustements' in fusion).toBe(false);
  });

  it('idempotence : ré-appliquer la même édition ne change rien', () => {
    const jours = joursDeLaSemaine('2026-W11');
    const saisieMois: EcrirePlanningDto = {
      complementMinutes: 30,
      joursSupplementaires: [
        ...jourSup('2026-03-02'),
        ...jourSup('2026-03-10'),
      ],
    };
    const besoins: BesoinsSemaine = {
      joursSupplementaires: jourSup('2026-03-12', 7),
    };
    const un = fusionnerSemaineDansMois(saisieMois, jours, besoins);
    const deux = fusionnerSemaineDansMois(un, jours, besoins);
    expect(deux).toEqual(un);
  });
});

describe('fusionnerSemaineDansMois — propriétés (fast-check)', () => {
  const jours = joursDeLaSemaine('2026-W11');
  const fenetre = new Set(jours);
  // Dates plausibles de mars 2026 (dans et hors fenêtre).
  const dateArb = fc
    .integer({ min: 1, max: 28 })
    .map((d) => `2026-03-${String(d).padStart(2, '0')}`);
  const jourSupArb = dateArb.map((date) => ({
    date,
    debutHeures: 8,
    debutMinutes: 0,
    finHeures: 12,
    finMinutes: 0,
  }));
  const besoinsArb = fc.record({
    joursSupplementaires: fc.array(jourSupArb, { maxLength: 5 }),
  });
  const saisieArb = fc.record({
    complementMinutes: fc.integer({ min: 0, max: 600 }),
    joursSupplementaires: fc.array(jourSupArb, { maxLength: 8 }),
  });

  it('préserve les scalaires mensuels (complementMinutes)', () => {
    fc.assert(
      fc.property(saisieArb, besoinsArb, (saisie, besoins) => {
        const fusion = fusionnerSemaineDansMois(saisie, jours, besoins);
        expect(fusion.complementMinutes).toBe(saisie.complementMinutes);
      }),
    );
  });

  it('préserve à l’identique les entrées datées HORS semaine', () => {
    fc.assert(
      fc.property(saisieArb, besoinsArb, (saisie, besoins) => {
        const fusion = fusionnerSemaineDansMois(saisie, jours, besoins);
        const horsAvant = saisie.joursSupplementaires.filter(
          (j) => !fenetre.has(j.date),
        );
        const horsApres = (fusion.joursSupplementaires ?? []).filter(
          (j) => !fenetre.has(j.date),
        );
        expect(horsApres).toEqual(horsAvant);
      }),
    );
  });

  it('dans la fenêtre : le résultat contient exactement les besoins de la semaine', () => {
    fc.assert(
      fc.property(saisieArb, besoinsArb, (saisie, besoins) => {
        const fusion = fusionnerSemaineDansMois(saisie, jours, besoins);
        const dansApres = (fusion.joursSupplementaires ?? []).filter((j) =>
          fenetre.has(j.date),
        );
        const attendus = besoins.joursSupplementaires.filter((j) =>
          fenetre.has(j.date),
        );
        expect(dansApres).toEqual(attendus);
      }),
    );
  });

  it('idempotence sur entrées arbitraires', () => {
    fc.assert(
      fc.property(saisieArb, besoinsArb, (saisie, besoins) => {
        const un = fusionnerSemaineDansMois(saisie, jours, besoins);
        const deux = fusionnerSemaineDansMois(un, jours, besoins);
        expect(deux).toEqual(un);
      }),
    );
  });
});
