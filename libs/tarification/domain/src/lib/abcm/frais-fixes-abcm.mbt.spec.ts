// MBT — DT-11 (Decision Table + BVA) ;
// Critère : combinatoire complète mois × premiereAnnee + BVA 3 points sur le mois (8|9|10) + valeurs invalides ;
// Traçabilité doc 17 ; SUT : abcm/frais-fixes-abcm.ts
import { describe, expect, it } from 'vitest';
import { Money } from '@creche-planner/shared-kernel';
import { FraisFixesAbcm } from './frais-fixes-abcm.js';
import { QuantiteInvalideError } from '../core/tarification-error.js';

/**
 * Modèle DT-11 — frais fixes ABCM (frais-fixes-abcm.ts L41-62).
 * Rattachement en septembre (mois = 9) uniquement.
 *   mois ≠ 9                       ⇒ 0 €
 *   mois = 9 ET premiereAnnee=false ⇒ cotisation (286 €)
 *   mois = 9 ET premiereAnnee=true  ⇒ cotisation + 1ère inscription (286 + 150 = 436 €)
 *   mois hors 1..12 ou non entier   ⇒ QuantiteInvalideError
 *
 * Frontière sensible : le mois de rattachement 9, encadré par 8 et 10 (BVA 3 points).
 */

const COTISATION = 28600; // 286,00 €
const INSCRIPTION = 15000; // 150,00 €

const frais = new FraisFixesAbcm();

describe('MBT DT-11 — combinatoire mois × premiereAnnee', () => {
  // Partition des mois : { septembre } vs { autres } × { 1ère année, suivantes }
  const cas: ReadonlyArray<[number, boolean, number]> = [
    // [mois, premiereAnnee, total centimes attendu]
    [9, false, COTISATION], // rattachement, année suivante
    [9, true, COTISATION + INSCRIPTION], // rattachement, 1ère année
    [1, false, 0], // hors rattachement
    [1, true, 0], // hors rattachement même en 1ère année
    [6, true, 0],
    [12, false, 0],
  ];

  it.each(cas)(
    'mois=%i premiereAnnee=%s ⇒ %i ct',
    (mois, premiereAnnee, attendu) => {
      const cout = frais.calculerCoutMois({ mois, premiereAnnee });
      expect(cout.total.centimes).toBe(attendu);
    },
  );

  it('septembre 1ère année ⇒ 2 lignes (cotisation + inscription)', () => {
    expect(
      frais.calculerCoutMois({ mois: 9, premiereAnnee: true }).lignes,
    ).toHaveLength(2);
  });

  it('septembre année suivante ⇒ 1 ligne (cotisation seule)', () => {
    expect(
      frais.calculerCoutMois({ mois: 9, premiereAnnee: false }).lignes,
    ).toHaveLength(1);
  });

  it('hors septembre ⇒ coût vide', () => {
    expect(
      frais.calculerCoutMois({ mois: 5, premiereAnnee: true }).estVide(),
    ).toBe(true);
  });
});

describe('MBT DT-11 — BVA 3 points sur le mois (8 | 9 | 10)', () => {
  const cas: ReadonlyArray<[string, number, number]> = [
    ['mois 8 (rattachement − 1) ⇒ 0', 8, 0],
    ['mois 9 (rattachement) ⇒ cotisation', 9, COTISATION],
    ['mois 10 (rattachement + 1) ⇒ 0', 10, 0],
  ];
  it.each(cas)('%s', (_l, mois, attendu) => {
    expect(
      frais.calculerCoutMois({ mois, premiereAnnee: false }).total.centimes,
    ).toBe(attendu);
  });
});

describe('MBT DT-11 — bornes calendaires (BVA 1..12) et valeurs invalides', () => {
  it('mois = 1 (borne basse valide) ⇒ accepté (0 €)', () => {
    expect(
      frais.calculerCoutMois({ mois: 1, premiereAnnee: false }).total.centimes,
    ).toBe(0);
  });

  it('mois = 12 (borne haute valide) ⇒ accepté (0 €)', () => {
    expect(
      frais.calculerCoutMois({ mois: 12, premiereAnnee: false }).total.centimes,
    ).toBe(0);
  });

  const invalides: ReadonlyArray<[string, number]> = [
    ['mois 0 (borne basse − 1)', 0],
    ['mois 13 (borne haute + 1)', 13],
    ['mois négatif', -1],
    ['mois non entier (9.5)', 9.5],
  ];
  it.each(invalides)('%s ⇒ QuantiteInvalideError', (_l, mois) => {
    expect(() => frais.calculerCoutMois({ mois, premiereAnnee: true })).toThrow(
      QuantiteInvalideError,
    );
  });
});

describe('MBT DT-11 — config personnalisée (montants pilotables)', () => {
  it('cotisation et inscription personnalisées s’additionnent en septembre 1ère année', () => {
    const sur = new FraisFixesAbcm({
      cotisationAnnuelle: Money.depuisEuros(300),
      fraisPremiereInscription: Money.depuisEuros(100),
    });
    expect(
      sur.calculerCoutMois({ mois: 9, premiereAnnee: true }).total.centimes,
    ).toBe(40000);
  });
});
