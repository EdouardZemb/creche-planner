// MBT — Consolidation = somme (property-based) ;
// Critère : property-based (total foyer = Σ des totaux agrégés ; associativité/commutativité de l'agrégation) ;
// Traçabilité doc 17 ; SUT : consolidation/cout-mois-foyer.ts
import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { Money, MontantNegatifError } from '@creche-planner/shared-kernel';
import { CoutMois, LigneDeCout } from '../core/cout-mois.js';
import { consoliderCoutMoisFoyer } from './cout-mois-foyer.js';

/**
 * Modèle « consolidation = somme » (cout-mois-foyer.ts).
 *   consoliderCoutMoisFoyer([c1, c2, …]).total === c1.total + c2.total + …
 * (sous réserve que chaque CoutMois agrégé ait un total défini, c.-à-d. ≥ 0).
 * L'agrégation concatène les lignes : elle est commutative et associative au
 * sens du total.
 */

/** Génère un CoutMois dont le total est garanti ≥ 0 (débits ≥ crédits). */
const arbCoutMoisPositif = fc
  .record({
    debits: fc.array(fc.nat({ max: 100_000 }), { maxLength: 6 }),
    creditsBruts: fc.array(fc.nat({ max: 100_000 }), { maxLength: 6 }),
  })
  .map(({ debits, creditsBruts }) => {
    const sommeDebits = debits.reduce((a, b) => a + b, 0);
    let restant = sommeDebits;
    const credits = creditsBruts.map((c) => {
      const v = Math.min(c, restant);
      restant -= v;
      return v;
    });
    const lignes = [
      ...debits.map((c) => LigneDeCout.debit('d', Money.depuisCentimes(c))),
      ...credits.map((c) => LigneDeCout.credit('c', Money.depuisCentimes(c))),
    ];
    return new CoutMois(lignes);
  });

describe('MBT — consolidation foyer = somme des coûts (property-based)', () => {
  it('total foyer == Σ des totaux des coûts agrégés', () => {
    fc.assert(
      fc.property(fc.array(arbCoutMoisPositif, { maxLength: 10 }), (couts) => {
        const sommeAttendue = couts.reduce(
          (acc, c) => acc + c.total.centimes,
          0,
        );
        expect(consoliderCoutMoisFoyer(couts).total.centimes).toBe(
          sommeAttendue,
        );
      }),
    );
  });

  it('commutativité : l’ordre des coûts agrégés n’influe pas sur le total', () => {
    fc.assert(
      fc.property(
        fc.array(arbCoutMoisPositif, { minLength: 1, maxLength: 8 }),
        (couts) => {
          const direct = consoliderCoutMoisFoyer(couts).total.centimes;
          const inverse = consoliderCoutMoisFoyer([...couts].reverse()).total
            .centimes;
          expect(inverse).toBe(direct);
        },
      ),
    );
  });

  it('associativité : agréger par sous-groupes donne le même total', () => {
    fc.assert(
      fc.property(
        fc.array(arbCoutMoisPositif, { minLength: 2, maxLength: 8 }),
        fc.nat(),
        (couts, coupureBrute) => {
          const i = couts.length === 0 ? 0 : coupureBrute % (couts.length + 1);
          const gauche = consoliderCoutMoisFoyer(couts.slice(0, i));
          const droite = consoliderCoutMoisFoyer(couts.slice(i));
          const parGroupes = consoliderCoutMoisFoyer([gauche, droite]).total
            .centimes;
          const aPlat = consoliderCoutMoisFoyer(couts).total.centimes;
          expect(parGroupes).toBe(aPlat);
        },
      ),
    );
  });

  it('liste vide ⇒ coût vide (élément neutre)', () => {
    expect(consoliderCoutMoisFoyer([]).estVide()).toBe(true);
    expect(consoliderCoutMoisFoyer([]).total.estZero()).toBe(true);
  });

  it('si les crédits agrégés dépassent les débits, le total lève (INV-06)', () => {
    const couts = [
      new CoutMois([LigneDeCout.debit('d', Money.depuisCentimes(100))]),
      new CoutMois([LigneDeCout.credit('c', Money.depuisCentimes(250))]),
    ];
    expect(() => consoliderCoutMoisFoyer(couts).total).toThrow(
      MontantNegatifError,
    );
  });
});
