import { describe, expect, it } from 'vitest';
import {
  BaremeEffortPsu,
  GrilleAbcm,
  consoliderCoutMoisFoyer,
} from '@creche-planner/tarification-domain';
import {
  parsePrestationRm,
  prestationEstVide,
  valoriserPrestation,
  type ContexteTarif,
  type FoyerCalcul,
  type PrestationRM,
} from './cout.mapper.js';

/**
 * Reproduit les cas-oracle CT-04 / CT-10 / CT-11 / CT-20 (doc 02 §6) **par le
 * chemin d'orchestration** : des lignes telles que les consommateurs les
 * écriraient dans le read model (`foyer`, `prestation_mois`) → mapper → domaine →
 * coût consolidé. On n'assert que des montants en centimes (cohérent `Money`).
 *
 * Depuis SFD 30 (D1/D2), le mapper ne détient plus aucun tarif : il reçoit un
 * **contexte** (grille ABCM + barème PSU) résolu à date par `cout.service`. Ici,
 * ce contexte reprend les valeurs 2026 T3 pour retrouver les oracles historiques.
 *
 * Foyer de référence (doc 02 §0) : ressources 6 716,92 € (671 692 c.), 2 enfants à charge,
 * RFR ⇒ Tranche 3.
 */
const FOYER: FoyerCalcul = {
  ressourcesMensuellesCentimes: 671692,
  nbEnfantsACharge: 2,
  tranche: 3,
};

/** Grille ABCM 2026 T3 (comme résolue par le service depuis la projection). */
const GRILLE_T3 = GrilleAbcm.depuisParametres({
  cantineTotalCentimes: 1268,
  cantinePartGardeCentimes: 801,
  periMatinCentimes: 333,
  periSoirCentimes: 705,
  alshJourneeCompleteCentimes: 2650,
  alshDemiJourneeCentimes: 950,
  alshRepasCentimes: 750,
});

/** Barème d'effort PSU 2026 (comme résolu par le service depuis la projection). */
const BAREME = new BaremeEffortPsu({
  '1': 0.000619,
  '2': 0.000516,
  '3': 0.000413,
  '4': 0.00031,
  '5': 0.00031,
  '6': 0.00031,
  '7': 0.00031,
  '8': 0.000206,
});

/** Contexte tarifaire 2026 T3 (grille ABCM + barème PSU). */
const CONTEXTE: ContexteTarif = { grille: GRILLE_T3, baremePsu: BAREME };

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
    const mia = valoriserPrestation(creche(885.5), FOYER, CONTEXTE);
    const zoe = valoriserPrestation(creche(831.5), FOYER, CONTEXTE);
    expect(consoliderCoutMoisFoyer([mia, zoe]).total.centimes).toBe(85116);
  });

  it('CT-10 — cantine 16 jours (T3) = 202,88 €', () => {
    const cout = valoriserPrestation(
      { mode: 'CANTINE', nbJours: 16 },
      FOYER,
      CONTEXTE,
    );
    expect(cout.total.centimes).toBe(20288);
  });

  it('CT-11 — périscolaire 8 matins + 12 soirs (T3) = 111,24 €', () => {
    const cout = valoriserPrestation(
      { mode: 'PERISCOLAIRE', nbMatins: 8, nbSoirs: 12 },
      FOYER,
      CONTEXTE,
    );
    expect(cout.total.centimes).toBe(11124);
  });

  it('CT-20 — mois mixte (crèche Mia + cantine + péri Zoé) = 753,08 € hors frais', () => {
    // Σ sans frais fixes : 438,96 + 202,88 + 111,24 = 753,08 €.
    const miaCreche = valoriserPrestation(creche(885.5), FOYER, CONTEXTE);
    const zoeCantine = valoriserPrestation(
      { mode: 'CANTINE', nbJours: 16 },
      FOYER,
      CONTEXTE,
    );
    const zoePeri = valoriserPrestation(
      { mode: 'PERISCOLAIRE', nbMatins: 8, nbSoirs: 12 },
      FOYER,
      CONTEXTE,
    );
    expect(
      consoliderCoutMoisFoyer([miaCreche, zoeCantine, zoePeri]).total.centimes,
    ).toBe(75308);
  });

  it('valorise une cantine PAI à la part garde (16 × 8,01 €) = 128,16 €', () => {
    const cout = valoriserPrestation(
      { mode: 'CANTINE', nbJours: 16, pai: true },
      FOYER,
      CONTEXTE,
    );
    expect(cout.total.centimes).toBe(12816);
  });

  it('valorise un ALSH (5 journées complètes T3) = 132,50 €', () => {
    const cout = valoriserPrestation(
      { mode: 'ALSH', nbJourneesCompletes: 5 },
      FOYER,
      CONTEXTE,
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
      CONTEXTE,
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
      CONTEXTE,
    );
    expect(cout.total.centimes).toBe(44376);
  });

  it('lève si la grille ABCM n’est pas résolue dans le contexte (bug de résolution)', () => {
    expect(() =>
      valoriserPrestation({ mode: 'CANTINE', nbJours: 16 }, FOYER, {
        baremePsu: BAREME,
      }),
    ).toThrow('grille ABCM non résolue');
  });

  it('lève si le barème PSU n’est pas résolu dans le contexte (bug de résolution)', () => {
    expect(() =>
      valoriserPrestation(creche(885.5), FOYER, { grille: GRILLE_T3 }),
    ).toThrow('barème PSU non résolu');
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
    expect(
      valoriserPrestation(prestation, FOYER, CONTEXTE).total.centimes,
    ).toBe(43896);
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

/**
 * `prestationEstVide` décide **si le coût d'un mois peut se passer des ressources
 * du foyer** (`AM-55`) : une prestation sans quantité vaut zéro quel que soit le
 * tarif, une prestation avec quantité impose de connaître les ressources — ou de
 * refuser. Se tromper dans un sens ferait refuser des mois inoffensifs, dans
 * l'autre ferait réapparaître le montant faux que le lot supprime. Les quatre
 * modes sont couverts, chacun avec son opposé.
 */
describe('prestationEstVide (garde du refus AM-55)', () => {
  const vides: readonly PrestationRM[] = [
    // Mois hors période : le domaine neutralise la mensualité lissée à zéro.
    {
      mode: 'CRECHE_PSU',
      heuresAnnuellesContractualisees: 0,
      nbMensualites: 7,
    },
    { mode: 'CANTINE', nbJours: 0 },
    { mode: 'PERISCOLAIRE', nbMatins: 0, nbSoirs: 0 },
    { mode: 'ALSH', nbJourneesCompletes: 0 },
  ];

  const pleines: readonly PrestationRM[] = [
    {
      mode: 'CRECHE_PSU',
      heuresAnnuellesContractualisees: 885.5,
      nbMensualites: 7,
    },
    // Mensualité neutralisée MAIS complément saisi : il se facture à la minute,
    // donc il faut le barème, donc les ressources.
    {
      mode: 'CRECHE_PSU',
      heuresAnnuellesContractualisees: 0,
      nbMensualites: 7,
      complementMinutes: 30,
    },
    { mode: 'CANTINE', nbJours: 1 },
    { mode: 'PERISCOLAIRE', nbMatins: 0, nbSoirs: 1 },
    { mode: 'PERISCOLAIRE', nbMatins: 1, nbSoirs: 0 },
    { mode: 'ALSH', nbJourneesCompletes: 1 },
    { mode: 'ALSH', nbJourneesCompletes: 0, nbDemiJournees: 1 },
    // Un repas seul se facture aussi : le compteur est distinct dans la grille.
    { mode: 'ALSH', nbJourneesCompletes: 0, nbDemiJournees: 0, nbRepas: 1 },
  ];

  it.each(vides)('vide : $mode', (prestation) => {
    expect(prestationEstVide(prestation)).toBe(true);
  });

  it.each(pleines)('non vide : $mode', (prestation) => {
    expect(prestationEstVide(prestation)).toBe(false);
  });
});
