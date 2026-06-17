// MBT — INV-06 (property-based) ;
// Critère : property-based INV-06 (CoutMois.total ≥ 0 pour lignes débit/crédit arbitraires, crédits ≤ débits) ;
// Traçabilité doc 17 ; SUT : core/cout-mois.ts
import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { Money, MontantNegatifError } from '@creche-planner/shared-kernel';
import { CoutMois, LigneDeCout } from './cout-mois.js';

/**
 * Modèle INV-06 — total d'un CoutMois (cout-mois.ts L43-54).
 *   total = Σ débits − Σ crédits   (l'ordre des lignes n'influe pas)
 * Invariant : un coût mensuel est ≥ 0. Si Σ crédits ≤ Σ débits le total est
 * défini et ≥ 0 ; sinon `Money.moins` lève `MontantNegatifError`.
 */

/** Génère une liste de débits et une liste de crédits (centimes ≥ 0). */
const arbMontants = fc.array(fc.nat({ max: 1_000_000 }), { maxLength: 30 });

describe('MBT INV-06 — CoutMois.total ≥ 0 (property-based)', () => {
  it('quand Σ crédits ≤ Σ débits, total = Σdébits − Σcrédits et reste ≥ 0', () => {
    fc.assert(
      fc.property(arbMontants, arbMontants, (debits, creditsBruts) => {
        const sommeDebits = debits.reduce((a, b) => a + b, 0);
        // borne les crédits pour garantir Σcrédits ≤ Σdébits
        let restant = sommeDebits;
        const credits = creditsBruts.map((c) => {
          const v = Math.min(c, restant);
          restant -= v;
          return v;
        });
        const sommeCredits = credits.reduce((a, b) => a + b, 0);

        const lignes = [
          ...debits.map((c) =>
            LigneDeCout.debit('debit', Money.depuisCentimes(c)),
          ),
          ...credits.map((c) =>
            LigneDeCout.credit('credit', Money.depuisCentimes(c)),
          ),
        ];
        const total = new CoutMois(lignes).total.centimes;
        expect(total).toBe(sommeDebits - sommeCredits);
        expect(total).toBeGreaterThanOrEqual(0);
      }),
    );
  });

  it('l’ordre des lignes n’influe pas sur le total (commutativité)', () => {
    fc.assert(
      fc.property(
        fc.array(fc.nat({ max: 100_000 }), { minLength: 1, maxLength: 20 }),
        (debits) => {
          const lignes = debits.map((c) =>
            LigneDeCout.debit('d', Money.depuisCentimes(c)),
          );
          const direct = new CoutMois(lignes).total.centimes;
          const inverse = new CoutMois([...lignes].reverse()).total.centimes;
          expect(inverse).toBe(direct);
        },
      ),
    );
  });

  it('quand Σ crédits > Σ débits, le total lève MontantNegatifError (INV-06)', () => {
    fc.assert(
      fc.property(
        fc.nat({ max: 100_000 }),
        fc.integer({ min: 1, max: 100_000 }),
        (debit, surplus) => {
          const cout = new CoutMois([
            LigneDeCout.debit('d', Money.depuisCentimes(debit)),
            LigneDeCout.credit('c', Money.depuisCentimes(debit + surplus)),
          ]);
          expect(() => cout.total).toThrow(MontantNegatifError);
        },
      ),
    );
  });
});
