import { describe, expect, it } from 'vitest';
import { Money, Tranche } from '@creche-planner/shared-kernel';
import { Foyer } from './foyer.js';
import { Enfant } from './enfant.js';
import {
  EnfantsAChargeInvalideError,
  NombreDePartsInvalideError,
} from './foyer-error.js';

/** Foyer de référence de référence (doc 02 §0). */
function foyerReel(): Foyer {
  return Foyer.creer({
    ressourcesMensuelles: Money.depuisEuros(6716.92),
    rfr: Money.depuisEuros(72705),
    nbEnfantsACharge: 2,
    nbParts: 3,
    enfants: [
      Enfant.creer({ prenom: 'Mia', dateNaissance: new Date('2024-12-08') }),
      Enfant.creer({ prenom: 'Zoé', dateNaissance: new Date('2023-03-12') }),
    ],
  });
}

describe('Foyer (composition + finances)', () => {
  it('porte les données financières saisies', () => {
    const foyer = foyerReel();
    expect(foyer.ressourcesMensuelles.egale(Money.depuisEuros(6716.92))).toBe(
      true,
    );
    expect(foyer.rfr.egale(Money.depuisEuros(72705))).toBe(true);
    expect(foyer.nbEnfantsACharge).toBe(2);
    expect(foyer.nbParts).toBe(3);
    expect(foyer.enfants).toHaveLength(2);
  });

  describe('tranche RFR déduite (doc 02 §0)', () => {
    it('classe le foyer de référence (RFR 72 705 €) en T3', () => {
      expect(foyerReel().tranche).toBe(Tranche.T3);
    });

    it('recalcule la tranche après réactualisation du RFR (Q-05)', () => {
      const apresBaisse = foyerReel().actualiserRfr(Money.depuisEuros(18000));
      expect(apresBaisse.tranche).toBe(Tranche.T1);
      // le foyer d'origine n'est pas muté
      expect(foyerReel().tranche).toBe(Tranche.T3);
    });
  });

  describe('invariants', () => {
    it('refuse un nb d’enfants à charge non entier', () => {
      expect(() =>
        Foyer.creer({
          ressourcesMensuelles: Money.zero(),
          rfr: Money.zero(),
          nbEnfantsACharge: 1.5,
          nbParts: 2,
        }),
      ).toThrow(EnfantsAChargeInvalideError);
    });

    it('refuse un foyer sans enfant à charge (< 1)', () => {
      expect(() =>
        Foyer.creer({
          ressourcesMensuelles: Money.zero(),
          rfr: Money.zero(),
          nbEnfantsACharge: 0,
          nbParts: 2,
        }),
      ).toThrow(EnfantsAChargeInvalideError);
    });

    it('refuse un nb de parts non strictement positif', () => {
      expect(() =>
        Foyer.creer({
          ressourcesMensuelles: Money.zero(),
          rfr: Money.zero(),
          nbEnfantsACharge: 1,
          nbParts: 0,
        }),
      ).toThrow(NombreDePartsInvalideError);
    });

    it('refuse un nb de parts non fini', () => {
      expect(() =>
        Foyer.creer({
          ressourcesMensuelles: Money.zero(),
          rfr: Money.zero(),
          nbEnfantsACharge: 1,
          nbParts: Number.POSITIVE_INFINITY,
        }),
      ).toThrow(NombreDePartsInvalideError);
    });
  });

  describe('composition', () => {
    it('a une liste d’enfants vide par défaut', () => {
      const sansEnfant = Foyer.creer({
        ressourcesMensuelles: Money.zero(),
        rfr: Money.zero(),
        nbEnfantsACharge: 1,
        nbParts: 2,
      });
      expect(sansEnfant.enfants).toEqual([]);
    });

    it('ajoute un enfant sans muter le foyer d’origine (immutabilité)', () => {
      const base = Foyer.creer({
        ressourcesMensuelles: Money.zero(),
        rfr: Money.zero(),
        nbEnfantsACharge: 1,
        nbParts: 2,
      });
      const augmente = base.ajouterEnfant(
        Enfant.creer({ prenom: 'Mia', dateNaissance: new Date('2024-12-08') }),
      );
      expect(base.enfants).toHaveLength(0);
      expect(augmente.enfants).toHaveLength(1);
      expect(augmente.enfants[0]?.prenom).toBe('Mia');
    });

    it('ne partage pas la référence du tableau d’enfants fourni à la création', () => {
      const enfants = [
        Enfant.creer({ prenom: 'Mia', dateNaissance: new Date('2024-12-08') }),
      ];
      const foyer = Foyer.creer({
        ressourcesMensuelles: Money.zero(),
        rfr: Money.zero(),
        nbEnfantsACharge: 1,
        nbParts: 2,
        enfants,
      });
      enfants.push(
        Enfant.creer({
          prenom: 'Zoé',
          dateNaissance: new Date('2023-03-12'),
        }),
      );
      expect(foyer.enfants).toHaveLength(1);
    });
  });
});
