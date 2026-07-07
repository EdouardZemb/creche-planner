/**
 * Extraction de la fenêtre d'une semaine (`fenetre.ts`).
 * Critère(s) de couverture : on ne retient que les entrées datées dans les 7 jours ;
 * fusion des deux mois d'une semaine à cheval ; saisies nulles/absentes et entrées
 * sans date ignorées ; forme canonique (jour vide omis). Propriétés : toute date du
 * snapshot appartient à la fenêtre ; idempotence par catégorie (le nombre d'items
 * retenus = nombre d'items datés dans la fenêtre). SUT : fenetre.ts.
 */
import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { extraireSemaine } from './fenetre.js';
import { joursDeLaSemaine } from './semaine.js';

const JOURS_W27 = joursDeLaSemaine('2026-W27'); // 2026-06-29 … 2026-07-05

const absence = (date: string) => ({
  date,
  debutHeures: 8,
  debutMinutes: 0,
  finHeures: 18,
  finMinutes: 0,
  preavisJours: 2,
  certificatMaladie: false,
});

describe('extraireSemaine — oracles', () => {
  it('ne retient que les entrées datées dans la fenêtre de la semaine', () => {
    const saisie = {
      complementMinutes: 30, // scalaire mensuel : hors périmètre jour
      absences: [
        absence('2026-06-29'), // dans la semaine
        absence('2026-06-15'), // hors semaine
      ],
    };
    const snap = extraireSemaine([saisie], JOURS_W27);
    expect(Object.keys(snap)).toEqual(['2026-06-29']);
    expect(snap['2026-06-29']?.absences).toHaveLength(1);
  });

  it('fusionne les saisies des deux mois d’une semaine à cheval', () => {
    const juin = { absences: [absence('2026-06-30')] };
    const juillet = { joursSupplementaires: [{ date: '2026-07-02' }] };
    const snap = extraireSemaine([juin, juillet], JOURS_W27);
    expect(Object.keys(snap).sort()).toEqual(['2026-06-30', '2026-07-02']);
    expect(snap['2026-07-02']?.joursSupplementaires).toHaveLength(1);
  });

  it('ignore les entrées sans date et les saisies nulles/absentes', () => {
    const saisie = { absences: [{ preavisJours: 0 }] }; // pas de `date`
    expect(extraireSemaine([saisie, null, undefined], JOURS_W27)).toEqual({});
  });

  it('regroupe par jour les cinq catégories datées', () => {
    const saisie = {
      joursSupplementaires: [{ date: '2026-06-29' }],
      absences: [absence('2026-06-29')],
      exceptions: [{ date: '2026-06-29', cantine: true }],
      joursAlsh: [{ date: '2026-06-29', type: 'COMPLETE' }],
      ajustements: [
        {
          date: '2026-06-29',
          debutHeures: 8,
          debutMinutes: 0,
          finHeures: 16,
          finMinutes: 30,
          preavisJours: 0,
          certificatMaladie: false,
        },
      ],
    };
    const snap = extraireSemaine([saisie], JOURS_W27);
    const jour = snap['2026-06-29'];
    expect(jour?.joursSupplementaires).toHaveLength(1);
    expect(jour?.absences).toHaveLength(1);
    expect(jour?.exceptions).toHaveLength(1);
    expect(jour?.joursAlsh).toHaveLength(1);
    expect(jour?.ajustements).toHaveLength(1);
  });

  it('un jour sans ajustement porte quand même la catégorie vide (forme canonique)', () => {
    const saisie = { absences: [absence('2026-06-29')] };
    const snap = extraireSemaine([saisie], JOURS_W27);
    // Catégorie absente de la saisie ≡ tableau vide dans le snapshot canonique.
    expect(snap['2026-06-29']?.ajustements).toEqual([]);
  });

  it('ignore une catégorie qui n’est pas un tableau', () => {
    const saisie = { absences: 'pas-un-tableau' };
    expect(extraireSemaine([saisie], JOURS_W27)).toEqual({});
  });
});

describe('extraireSemaine — propriétés', () => {
  /** Arbitraire : un jour dans la fenêtre W27, ou un jour hors fenêtre. */
  const horsFenetre = ['2026-06-15', '2026-07-20', '2026-01-01'] as const;
  const dateArb = fc.oneof(
    fc.constantFrom(...JOURS_W27),
    fc.constantFrom(...horsFenetre),
  );

  it('toute date du snapshot appartient à la fenêtre', () => {
    fc.assert(
      fc.property(fc.array(dateArb), (dates) => {
        const saisie = { absences: dates.map((d) => absence(d)) };
        const snap = extraireSemaine([saisie], JOURS_W27);
        const fenetre = new Set(JOURS_W27);
        return Object.keys(snap).every((d) => fenetre.has(d));
      }),
    );
  });

  it('retient exactement les entrées datées dans la fenêtre', () => {
    fc.assert(
      fc.property(fc.array(dateArb), (dates) => {
        const saisie = { absences: dates.map((d) => absence(d)) };
        const snap = extraireSemaine([saisie], JOURS_W27);
        const fenetre = new Set(JOURS_W27);
        const attendu = dates.filter((d) => fenetre.has(d)).length;
        const retenu = Object.values(snap).reduce(
          (n, jour) => n + jour.absences.length,
          0,
        );
        return retenu === attendu;
      }),
    );
  });
});
