import { describe, expect, it } from 'vitest';
import { Duree, Money, Tranche } from '@creche-planner/shared-kernel';
import { consoliderCoutMoisFoyer } from './cout-mois-foyer.js';
import { TarifCrechePsu } from '../psu/tarif-creche-psu.js';
import { GrilleAbcm } from '../abcm/grille-abcm.js';
import { TarifCantineAbcm } from '../abcm/tarif-cantine-abcm.js';
import { TarifPeriscolaireAbcm } from '../abcm/tarif-periscolaire-abcm.js';
import { FraisFixesAbcm } from '../abcm/frais-fixes-abcm.js';
import { CoutMois } from '../core/cout-mois.js';

const RESSOURCES = Money.depuisEuros(6716.92);
const psu = new TarifCrechePsu({
  ressourcesMensuelles: RESSOURCES,
  nbEnfantsACharge: 2,
});
const grilleT3 = GrilleAbcm.pour(Tranche.T3);

describe('consoliderCoutMoisFoyer (doc 02 §2, CT-20)', () => {
  it('CT-04 — total foyer crèche (Mia + Zoé) = 851,16 €', () => {
    const mia = psu.calculerCoutMois({
      heuresAnnuellesContractualisees: 885.5,
      nbMensualites: 7,
    });
    const zoe = psu.calculerCoutMois({
      heuresAnnuellesContractualisees: 831.5,
      nbMensualites: 7,
    });
    expect(consoliderCoutMoisFoyer([mia, zoe]).total.centimes).toBe(85116);
  });

  it('CT-20 — mois mixte sept. 2026 : crèche Mia + ABCM Zoé = 1 189,08 €', () => {
    const miaCreche = psu.calculerCoutMois({
      heuresAnnuellesContractualisees: 885.5,
      nbMensualites: 7,
    }); // 438,96 €
    const zoeCantine = new TarifCantineAbcm(grilleT3).calculerCoutMois({
      nbJours: 16,
    }); // 202,88 €
    const zoePeri = new TarifPeriscolaireAbcm(grilleT3).calculerCoutMois({
      nbMatins: 8,
      nbSoirs: 12,
    }); // 111,24 €
    const fraisSept = new FraisFixesAbcm().calculerCoutMois({
      mois: 9,
      premiereAnnee: true,
    }); // 436 €

    const foyer = consoliderCoutMoisFoyer([
      miaCreche,
      zoeCantine,
      zoePeri,
      fraisSept,
    ]);
    expect(foyer.total.centimes).toBe(118908);
  });

  it('agrège correctement débits et crédits entre prestations', () => {
    const mia = psu.calculerCoutMois({
      heuresAnnuellesContractualisees: 885.5,
      nbMensualites: 7,
    }); // 438,96 €
    const zoeAvecDeduction = psu.calculerCoutMois({
      heuresAnnuellesContractualisees: 831.5,
      nbMensualites: 7,
      absences: [
        {
          duree: Duree.depuisHeuresMinutes(8, 0),
          preavisJours: 3,
          certificatMaladie: false,
        },
      ],
    }); // 384,44 €
    expect(
      consoliderCoutMoisFoyer([mia, zoeAvecDeduction]).total.centimes,
    ).toBe(82340);
  });

  it('retourne un coût nul pour un foyer sans prestation', () => {
    const foyer = consoliderCoutMoisFoyer([new CoutMois([])]);
    expect(foyer.total.estZero()).toBe(true);
  });
});
