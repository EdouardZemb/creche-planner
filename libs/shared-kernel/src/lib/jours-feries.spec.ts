import { describe, expect, it } from 'vitest';
import { joursFeries, REGIMES_FERIES } from './jours-feries.js';
import { AnneeInvalideError } from './domain-error.js';

/**
 * Les attendus sont écrits **en dur**, année par année : c'est le seul moyen que
 * le test juge l'algorithme au lieu de le re-dériver. Pâques 2026 tombe le
 * 5 avril, Pâques 2027 le 28 mars.
 */
describe('joursFeries — régime national (FR)', () => {
  it('2026 : les 11 fériés nationaux, triés', () => {
    expect(joursFeries(2026, 'FR')).toEqual([
      { jour: '2026-01-01', libelle: "Jour de l'an" },
      { jour: '2026-04-06', libelle: 'Lundi de Pâques' },
      { jour: '2026-05-01', libelle: 'Fête du Travail' },
      { jour: '2026-05-08', libelle: 'Victoire 1945' },
      { jour: '2026-05-14', libelle: 'Ascension' },
      { jour: '2026-05-25', libelle: 'Lundi de Pentecôte' },
      { jour: '2026-07-14', libelle: 'Fête nationale' },
      { jour: '2026-08-15', libelle: 'Assomption' },
      { jour: '2026-11-01', libelle: 'Toussaint' },
      { jour: '2026-11-11', libelle: 'Armistice 1918' },
      { jour: '2026-12-25', libelle: 'Noël' },
    ]);
  });

  it('2027 : les mobiles suivent Pâques (28 mars)', () => {
    expect(joursFeries(2027, 'FR')).toEqual([
      { jour: '2027-01-01', libelle: "Jour de l'an" },
      { jour: '2027-03-29', libelle: 'Lundi de Pâques' },
      { jour: '2027-05-01', libelle: 'Fête du Travail' },
      { jour: '2027-05-06', libelle: 'Ascension' },
      { jour: '2027-05-08', libelle: 'Victoire 1945' },
      { jour: '2027-05-17', libelle: 'Lundi de Pentecôte' },
      { jour: '2027-07-14', libelle: 'Fête nationale' },
      { jour: '2027-08-15', libelle: 'Assomption' },
      { jour: '2027-11-01', libelle: 'Toussaint' },
      { jour: '2027-11-11', libelle: 'Armistice 1918' },
      { jour: '2027-12-25', libelle: 'Noël' },
    ]);
  });
});

describe('joursFeries — droit local d’Alsace-Moselle', () => {
  it('2026 : ajoute le Vendredi saint et le 26 décembre, et rien d’autre', () => {
    expect(joursFeries(2026, 'FR_ALSACE_MOSELLE')).toEqual([
      { jour: '2026-01-01', libelle: "Jour de l'an" },
      { jour: '2026-04-03', libelle: 'Vendredi saint' },
      { jour: '2026-04-06', libelle: 'Lundi de Pâques' },
      { jour: '2026-05-01', libelle: 'Fête du Travail' },
      { jour: '2026-05-08', libelle: 'Victoire 1945' },
      { jour: '2026-05-14', libelle: 'Ascension' },
      { jour: '2026-05-25', libelle: 'Lundi de Pentecôte' },
      { jour: '2026-07-14', libelle: 'Fête nationale' },
      { jour: '2026-08-15', libelle: 'Assomption' },
      { jour: '2026-11-01', libelle: 'Toussaint' },
      { jour: '2026-11-11', libelle: 'Armistice 1918' },
      { jour: '2026-12-25', libelle: 'Noël' },
      { jour: '2026-12-26', libelle: 'Saint-Étienne' },
    ]);
  });

  it('2027 : le Vendredi saint suit Pâques (26 mars)', () => {
    const feries = joursFeries(2027, 'FR_ALSACE_MOSELLE');
    expect(feries).toContainEqual({
      jour: '2027-03-26',
      libelle: 'Vendredi saint',
    });
    expect(feries).toHaveLength(13);
  });

  it('l’écart avec le régime national est exactement de deux jours', () => {
    const national = joursFeries(2026, 'FR').map((f) => f.jour);
    const local = joursFeries(2026, 'FR_ALSACE_MOSELLE').map((f) => f.jour);
    expect(local.filter((j) => !national.includes(j))).toEqual([
      '2026-04-03',
      '2026-12-26',
    ]);
    expect(national.filter((j) => !local.includes(j))).toEqual([]);
  });
});

describe('joursFeries — robustesse du calcul de Pâques', () => {
  /**
   * Lundis de Pâques de référence (comput grégorien), choisis aux extrêmes de la
   * plage possible du dimanche de Pâques — 22 mars au plus tôt (1818), 25 avril au
   * plus tard (1943, 2038) — et sur une année séculaire non bissextile (2100).
   */
  const LUNDIS_DE_PAQUES: [number, string][] = [
    [1818, '1818-03-23'],
    [1943, '1943-04-26'],
    [2024, '2024-04-01'],
    [2025, '2025-04-21'],
    [2030, '2030-04-22'],
    [2038, '2038-04-26'],
    [2100, '2100-03-29'],
  ];

  it.each(LUNDIS_DE_PAQUES)('lundi de Pâques %i = %s', (annee, attendu) => {
    expect(
      joursFeries(annee, 'FR').find((f) => f.libelle === 'Lundi de Pâques')
        ?.jour,
    ).toBe(attendu);
  });

  /**
   * ⚠️ La version précédente de ce test balayait 2020-2040 — une fenêtre **sans
   * aucune collision**. Il affirmait donc l'invariant sans jamais l'exercer : la
   * garde était verte parce qu'elle ne regardait pas. Le balayage couvre désormais
   * toute la plage utile, et les années de collision sont nommées en propre.
   */
  it('aucune année de 1583 à 2200 ne produit de doublon de date', () => {
    for (let annee = 1583; annee <= 2200; annee += 1) {
      for (const regime of REGIMES_FERIES) {
        const jours = joursFeries(annee, regime).map((f) => f.jour);
        expect(new Set(jours).size).toBe(jours.length);
      }
    }
  });

  it('un jour portant deux fériés ne compte qu’une fois, sous le libellé fixe', () => {
    // Pâques 2059 tombe le 30 mars : Ascension = 30/03 + 39 = 8 mai, jour de la
    // Victoire 1945. Le jour est fermé une seule fois.
    const feries = joursFeries(2059, 'FR');
    expect(feries.filter((f) => f.jour === '2059-05-08')).toEqual([
      { jour: '2059-05-08', libelle: 'Victoire 1945' },
    ]);
    expect(feries).toHaveLength(10);
    expect(feries.some((f) => f.libelle === 'Ascension')).toBe(false);
    // Une année sans collision en porte bien 11.
    expect(joursFeries(2026, 'FR')).toHaveLength(11);
  });

  it('refuse une année hors plage grégorienne', () => {
    expect(() => joursFeries(1582, 'FR')).toThrow(AnneeInvalideError);
    expect(() => joursFeries(10000, 'FR')).toThrow(AnneeInvalideError);
    expect(() => joursFeries(2026.5, 'FR')).toThrow(AnneeInvalideError);
  });
});
