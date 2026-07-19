/**
 * MBT — socle « entité versionnée » (SFD 30, lot 1).
 * Invariants vérifiés par propriété (fast-check) :
 *  - INV-V1 (résolution unique) : pour toute suite valide de versions et toute date
 *    dans la couverture, EXACTEMENT une version s'applique ; hors couverture, aucune.
 *  - INV-V2 (sélection cohérente) : la version sélectionnée couvre bien la date.
 *  - INV-V3 (veille stricte) : `cloreVersionPrecedente(d) < d` — clore la version
 *    précédente ne crée jamais de chevauchement avec la version prenant effet à `d`.
 *  - INV-V4 (suite bien formée) : une suite construite par `depuisSuite` ne présente
 *    ni chevauchement ni trou.
 * SUT : versionnement.ts.
 */
import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import {
  cloreVersionPrecedente,
  depuisSuite,
  selectionnerVersionApplicable,
  verifierAbsenceChevauchement,
  verifierContinuite,
} from './versionnement.js';

/** Date ISO valide (jour ≤ 28 pour rester valide quel que soit le mois). */
const isoGen = fc
  .tuple(
    fc.integer({ min: 2000, max: 2099 }),
    fc.integer({ min: 1, max: 12 }),
    fc.integer({ min: 1, max: 28 }),
  )
  .map(
    ([a, m, j]) =>
      `${String(a).padStart(4, '0')}-${String(m).padStart(2, '0')}-${String(
        j,
      ).padStart(2, '0')}`,
  );

/** Suite non vide de dates d'effet distinctes, triées par ordre croissant. */
const suiteGen = fc
  .uniqueArray(isoGen, { minLength: 1, maxLength: 6 })
  .map((ds) => [...ds].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0)));

const versionsDe = (triees: readonly string[]) =>
  depuisSuite(triees.map((dateEffet, i) => ({ dateEffet, valeur: i })));

describe('MBT versionnement', () => {
  it('INV-V1 résolution unique : 1 version dans la couverture, 0 avant', () => {
    fc.assert(
      fc.property(suiteGen, isoGen, (triees, cible) => {
        const versions = versionsDe(triees);
        const couvrantes = versions.filter((v) => v.periode.contient(cible));
        const premier = triees[0];
        if (premier !== undefined && cible >= premier) {
          return couvrantes.length === 1;
        }
        return couvrantes.length === 0;
      }),
    );
  });

  it('INV-V2 sélection cohérente : la version choisie couvre la date', () => {
    fc.assert(
      fc.property(suiteGen, isoGen, (triees, cible) => {
        const premier = triees[0];
        fc.pre(premier !== undefined && cible >= premier);
        const choisie = selectionnerVersionApplicable(
          versionsDe(triees),
          cible,
        );
        return choisie.periode.contient(cible);
      }),
    );
  });

  it('INV-V3 veille stricte : cloreVersionPrecedente(d) < d', () => {
    fc.assert(fc.property(isoGen, (d) => cloreVersionPrecedente(d) < d));
  });

  it('INV-V4 suite bien formée : ni chevauchement ni trou', () => {
    fc.assert(
      fc.property(suiteGen, (triees) => {
        const versions = versionsDe(triees);
        expect(() => {
          verifierAbsenceChevauchement(versions.map((v) => v.periode));
        }).not.toThrow();
        expect(() => {
          verifierContinuite(versions);
        }).not.toThrow();
      }),
    );
  });
});
