import { describe, expect, it } from 'vitest';
import { consoliderCoutMoisFoyer } from '@creche-planner/tarification-domain';
import {
  parsePrestationRm,
  valoriserPrestation,
  type FoyerCalcul,
  type PrestationRM,
} from './cout.mapper.js';

/**
 * Reproduit les cas-oracle CT-04 / CT-10 / CT-11 / CT-20 (doc 02 §6) **par le
 * chemin d'orchestration** : des lignes telles que les consommateurs les
 * écriraient dans le read model (`foyer`, `prestation_mois`) → mapper → domaine →
 * coût consolidé. On n'assert que des montants en centimes (cohérent `Money`).
 *
 * Foyer de référence (doc 02 §0) : ressources 6 716,92 € (671 692 c.), 2 enfants à charge,
 * RFR ⇒ Tranche 3.
 */
const FOYER: FoyerCalcul = {
  ressourcesMensuellesCentimes: 671692,
  nbEnfantsACharge: 2,
  tranche: 3,
};

/** Prestation crèche projetée pour un enfant (heures annuelles / mensualités). */
function creche(heuresAnnuelles: number): PrestationRM {
  return {
    mode: 'CRECHE_PSU',
    heuresAnnuellesContractualisees: heuresAnnuelles,
    nbMensualites: 7,
  };
}

describe('Orchestration Tarification — read model → domaine → coût', () => {
  it('CT-04 — total foyer crèche (Mia 885,5 h + Zoé 831,5 h) = 851,16 €', () => {
    const mia = valoriserPrestation(creche(885.5), FOYER);
    const zoe = valoriserPrestation(creche(831.5), FOYER);
    expect(consoliderCoutMoisFoyer([mia, zoe]).total.centimes).toBe(85116);
  });

  it('CT-10 — cantine 16 jours (T3) = 202,88 €', () => {
    const cout = valoriserPrestation({ mode: 'CANTINE', nbJours: 16 }, FOYER);
    expect(cout.total.centimes).toBe(20288);
  });

  it('CT-11 — périscolaire 8 matins + 12 soirs (T3) = 111,24 €', () => {
    const cout = valoriserPrestation(
      { mode: 'PERISCOLAIRE', nbMatins: 8, nbSoirs: 12 },
      FOYER,
    );
    expect(cout.total.centimes).toBe(11124);
  });

  it('CT-20 — mois mixte (crèche Mia + cantine + péri Zoé) = 753,08 € hors frais', () => {
    // Σ sans frais fixes : 438,96 + 202,88 + 111,24 = 753,08 €.
    const miaCreche = valoriserPrestation(creche(885.5), FOYER);
    const zoeCantine = valoriserPrestation(
      { mode: 'CANTINE', nbJours: 16 },
      FOYER,
    );
    const zoePeri = valoriserPrestation(
      { mode: 'PERISCOLAIRE', nbMatins: 8, nbSoirs: 12 },
      FOYER,
    );
    expect(
      consoliderCoutMoisFoyer([miaCreche, zoeCantine, zoePeri]).total.centimes,
    ).toBe(75308);
  });

  it('valorise une cantine PAI à la part garde (16 × 8,01 €) = 128,16 €', () => {
    const cout = valoriserPrestation(
      { mode: 'CANTINE', nbJours: 16, pai: true },
      FOYER,
    );
    expect(cout.total.centimes).toBe(12816);
  });

  it('valorise un ALSH (5 journées complètes T3) = 132,50 €', () => {
    const cout = valoriserPrestation(
      { mode: 'ALSH', nbJourneesCompletes: 5 },
      FOYER,
    );
    expect(cout.total.centimes).toBe(13250);
  });

  it('reporte une déduction d’absence crèche projetée (8 h, Zoé) → 384,44 €', () => {
    const cout = valoriserPrestation(
      {
        mode: 'CRECHE_PSU',
        heuresAnnuellesContractualisees: 831.5,
        nbMensualites: 7,
        heuresDeduitesMinutes: 480,
      },
      FOYER,
    );
    expect(cout.total.centimes).toBe(38444);
  });

  it('reporte un complément crèche projeté (83 min, Mia) → 443,76 €', () => {
    const cout = valoriserPrestation(
      {
        mode: 'CRECHE_PSU',
        heuresAnnuellesContractualisees: 885.5,
        nbMensualites: 7,
        complementMinutes: 83,
      },
      FOYER,
    );
    expect(cout.total.centimes).toBe(44376);
  });
});

/**
 * AQ-03 (doc 27) — validation Zod en remplacement des casts `as (unknown as)
 * PrestationRM` : une prestation projetée non conforme (jsonb corrompu, contrat
 * amont rompu) doit lever une erreur EXPLICITE, jamais traverser silencieusement
 * le calcul des coûts.
 */
describe('parsePrestationRm (AQ-03)', () => {
  it('accepte une prestation crèche sérialisée par Planification (champs en plus tolérés)', () => {
    const prestation = parsePrestationRm({
      mode: 'CRECHE_PSU',
      heuresAnnuellesContractualisees: 885.5,
      nbMensualites: 7,
      heuresMensualisees: 126.5,
      complementMinutes: 0,
      heuresReserveesMinutes: 7590,
      heuresDeduitesMinutes: 0,
    });
    expect(prestation.mode).toBe('CRECHE_PSU');
    // Les champs hors schéma sont transportés tels quels (looseObject).
    expect(prestation['heuresMensualisees']).toBe(126.5);
    // Et la prestation validée se valorise normalement (CT-04 enfant 1).
    expect(valoriserPrestation(prestation, FOYER).total.centimes).toBe(43896);
  });

  it('rejette une prestation au mode inconnu avec une erreur explicite', () => {
    expect(() => parsePrestationRm({ mode: 'GARDERIE', nbJours: 3 })).toThrow(
      /prestation projetée invalide/,
    );
  });

  it('rejette une cantine sans nbJours (champ obligatoire manquant)', () => {
    expect(() => parsePrestationRm({ mode: 'CANTINE' })).toThrow(
      /prestation projetée invalide/,
    );
  });

  it('rejette une crèche dont les heures sont une chaîne (type corrompu)', () => {
    expect(() =>
      parsePrestationRm({
        mode: 'CRECHE_PSU',
        heuresAnnuellesContractualisees: '885.5',
        nbMensualites: 7,
      }),
    ).toThrow(/prestation projetée invalide/);
  });

  it('rejette une valeur non-objet (jsonb null ou scalaire)', () => {
    expect(() => parsePrestationRm(null)).toThrow(
      /prestation projetée invalide/,
    );
    expect(() => parsePrestationRm('CANTINE')).toThrow(
      /prestation projetée invalide/,
    );
  });
});
