import { describe, expect, it } from 'vitest';
import { Duree, Money } from '@creche-planner/shared-kernel';
import { TarifCrechePsu } from './tarif-creche-psu.js';
import { BaremeEffortPsu } from './bareme-effort-psu.js';
import { DeductionExcessiveError } from '../core/tarification-error.js';

/** Jeu de données de référence (doc 02 §0). */
const RESSOURCES = Money.depuisEuros(6716.92);

function tarifFoyer(): TarifCrechePsu {
  return new TarifCrechePsu({
    ressourcesMensuelles: RESSOURCES,
    nbEnfantsACharge: 2,
  });
}

describe('TarifCrechePsu (crèche PSU/CNAF, doc 02 §3)', () => {
  it('CT-01 — tarif horaire = ressources × taux d’effort = 3,47 €/h', () => {
    expect(tarifFoyer().tarifHoraire.centimes).toBe(347);
  });

  it('CT-02 — mensualité Mia (885,50 h / 7) = 438,96 €', () => {
    const cout = tarifFoyer().calculerCoutMois({
      heuresAnnuellesContractualisees: 885.5,
      nbMensualites: 7,
    });
    expect(cout.total.centimes).toBe(43896);
  });

  it('CT-03 — mensualité Zoé crèche (831,50 h / 7) = 412,20 €', () => {
    const cout = tarifFoyer().calculerCoutMois({
      heuresAnnuellesContractualisees: 831.5,
      nbMensualites: 7,
    });
    expect(cout.total.centimes).toBe(41220);
  });

  it('CT-05 — complément +1 h 23 (83 min) Mia → 443,76 €', () => {
    const cout = tarifFoyer().calculerCoutMois({
      heuresAnnuellesContractualisees: 885.5,
      nbMensualites: 7,
      complement: Duree.depuisMinutes(83),
    });
    expect(cout.total.centimes).toBe(44376);
  });

  it('ignore un complément nul (pas de ligne superflue)', () => {
    const cout = tarifFoyer().calculerCoutMois({
      heuresAnnuellesContractualisees: 885.5,
      nbMensualites: 7,
      complement: Duree.zero(),
    });
    expect(cout.lignes).toHaveLength(1);
    expect(cout.total.centimes).toBe(43896);
  });

  it('CT-06 — absence Zoé prévenue 3 j (8 h déductibles) → 384,44 €', () => {
    const cout = tarifFoyer().calculerCoutMois({
      heuresAnnuellesContractualisees: 831.5,
      nbMensualites: 7,
      absences: [
        {
          duree: Duree.depuisHeuresMinutes(8, 0),
          preavisJours: 3,
          certificatMaladie: false,
        },
      ],
    });
    expect(cout.total.centimes).toBe(38444);
  });

  it('CT-07 — absence prévenue la veille (carence) non déductible → 412,20 €', () => {
    const cout = tarifFoyer().calculerCoutMois({
      heuresAnnuellesContractualisees: 831.5,
      nbMensualites: 7,
      absences: [
        {
          duree: Duree.depuisHeuresMinutes(8, 0),
          preavisJours: 1,
          certificatMaladie: false,
        },
      ],
    });
    expect(cout.lignes).toHaveLength(1);
    expect(cout.total.centimes).toBe(41220);
  });

  it('CT-08 — maladie 2 jours avec certificat (16 h) → 356,68 €', () => {
    const cout = tarifFoyer().calculerCoutMois({
      heuresAnnuellesContractualisees: 831.5,
      nbMensualites: 7,
      absences: [
        {
          duree: Duree.depuisHeuresMinutes(8, 0),
          preavisJours: 0,
          certificatMaladie: true,
        },
        {
          duree: Duree.depuisHeuresMinutes(8, 0),
          preavisJours: 0,
          certificatMaladie: true,
        },
      ],
    });
    expect(cout.total.centimes).toBe(35668);
  });

  it('refuse une déduction supérieure aux heures réservées (INV-05)', () => {
    const tarif = tarifFoyer();
    expect(() =>
      tarif.calculerCoutMois({
        heuresAnnuellesContractualisees: 70,
        nbMensualites: 7, // → 10 h mensualisées
        absences: [
          {
            duree: Duree.depuisHeuresMinutes(11, 0),
            preavisJours: 5,
            certificatMaladie: false,
          },
        ],
      }),
    ).toThrow(DeductionExcessiveError);
  });

  it('borne les ressources au plafond CNAF', () => {
    const tarif = new TarifCrechePsu({
      ressourcesMensuelles: Money.depuisEuros(100000),
      nbEnfantsACharge: 2,
      plafond: RESSOURCES,
    });
    expect(tarif.tarifHoraire.centimes).toBe(347);
  });

  it('borne les ressources au plancher CNAF', () => {
    const tarif = new TarifCrechePsu({
      ressourcesMensuelles: Money.depuisEuros(1000),
      nbEnfantsACharge: 2,
      plancher: RESSOURCES,
    });
    expect(tarif.tarifHoraire.centimes).toBe(347);
  });

  it('accepte un barème explicite (pattern Stratégie)', () => {
    const tarif = new TarifCrechePsu({
      ressourcesMensuelles: RESSOURCES,
      nbEnfantsACharge: 1,
      bareme: new BaremeEffortPsu(),
    });
    // 6 716,92 € × 0,0619 % = 4,1578 €/h → arrondi 4,16 €/h
    expect(tarif.tarifHoraire.centimes).toBe(416);
    expect(tarif.mode).toBe('CRECHE_PSU');
  });
});

// Triage mutation AQ-13 (doc 27) : bornes et contrat d'affichage que les
// mutants survivants ont révélés non assertés.
describe('TarifCrechePsu — triage mutation AQ-13', () => {
  it('BVA INV-08 — préavis de 2 jours pile (sans certificat) ⇒ déductible', () => {
    // Tuait le mutant `preavisJours >= 2` → `> 2` : la borne exacte du
    // « prévenue au moins 2 jours » (doc 02 §3.2) n'était testée nulle part.
    const cout = tarifFoyer().calculerCoutMois({
      heuresAnnuellesContractualisees: 831.5,
      nbMensualites: 7,
      absences: [
        {
          duree: Duree.depuisHeuresMinutes(8, 0),
          preavisJours: 2,
          certificatMaladie: false,
        },
      ],
    });
    expect(cout.total.centimes).toBe(38444); // même montant que CT-06 (3 j)
  });

  it('libelle les lignes : Mensualité, Complément (dépassement), Déduction absences', () => {
    const cout = tarifFoyer().calculerCoutMois({
      heuresAnnuellesContractualisees: 831.5,
      nbMensualites: 7,
      complement: Duree.depuisMinutes(83),
      absences: [
        {
          duree: Duree.depuisHeuresMinutes(8, 0),
          preavisJours: 3,
          certificatMaladie: false,
        },
      ],
    });
    expect(cout.lignes.map((l) => l.libelle)).toEqual([
      'Mensualité',
      'Complément (dépassement)',
      'Déduction absences',
    ]);
  });

  it('INV-05 — le message explicite les heures en cause', () => {
    expect(() =>
      tarifFoyer().calculerCoutMois({
        heuresAnnuellesContractualisees: 70,
        nbMensualites: 7, // → 10 h mensualisées
        absences: [
          {
            duree: Duree.depuisHeuresMinutes(11, 0),
            preavisJours: 5,
            certificatMaladie: false,
          },
        ],
      }),
    ).toThrow('heures déduites (11) > heures mensualisées (10) (INV-05)');
  });

  it('nomme le champ fautif dans les erreurs de saisie (INV-01)', () => {
    expect(() =>
      tarifFoyer().calculerCoutMois({
        heuresAnnuellesContractualisees: -1,
        nbMensualites: 7,
      }),
    ).toThrow('heuresAnnuellesContractualisees');
    expect(() =>
      tarifFoyer().calculerCoutMois({
        heuresAnnuellesContractualisees: 885.5,
        nbMensualites: 0,
      }),
    ).toThrow('nbMensualites');
  });
});
