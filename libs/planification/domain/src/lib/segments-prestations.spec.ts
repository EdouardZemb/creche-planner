import { describe, expect, it } from 'vitest';
import {
  genererPrestationMoisSegments,
  type ContratPourGeneration,
  type SaisiePlanningJson,
} from './generation-prestations.js';
import { ParametreContratInvalideError } from './planification-error.js';
import type {
  PrestationsMoisAlsh,
  PrestationsMoisCantine,
  PrestationsMoisCreche,
  PrestationsMoisPeriscolaire,
} from './prestations-mois.types.js';

// Octobre 2026 : les lundis sont les 05, 12, 19 et 26 (4 lundis).
const MOIS = '2026-10';

/** Segment crèche : une plage lundi (minutes), période et paramètres mensuels. */
function segmentCreche(
  valideDu: string,
  valideAu: string | null,
  finHeures: number,
  overrides: Partial<ContratPourGeneration> = {},
): ContratPourGeneration {
  return {
    mode: 'CRECHE_PSU',
    valideDu,
    valideAu,
    heuresAnnuellesContractualisees: 885.5,
    nbMensualites: 7,
    semaineType: {
      LUNDI: [{ debutHeures: 8, debutMinutes: 30, finHeures, finMinutes: 0 }],
    },
    semaineAbcm: null,
    ...overrides,
  };
}

/** Segment ABCM : une inscription lundi, période. */
function segmentAbcm(
  mode: 'CANTINE' | 'PERISCOLAIRE' | 'ALSH',
  valideDu: string,
  valideAu: string | null,
  semaineAbcm: ContratPourGeneration['semaineAbcm'],
): ContratPourGeneration {
  return {
    mode,
    valideDu,
    valideAu,
    heuresAnnuellesContractualisees: null,
    nbMensualites: null,
    semaineType: null,
    semaineAbcm,
  };
}

describe('genererPrestationMoisSegments', () => {
  it('lève ParametreContratInvalideError si aucun segment', () => {
    expect(() => genererPrestationMoisSegments([], MOIS, {}, [])).toThrowError(
      ParametreContratInvalideError,
    );
  });

  it('un seul segment = comportement historique (délégation)', () => {
    const presta = genererPrestationMoisSegments(
      [segmentCreche('2026-01-01', '2026-12-31', 17)],
      MOIS,
      { complementMinutes: 30 },
      ['2026-10-12'],
    ) as PrestationsMoisCreche;
    // 4 lundis × 510 − le 12 non facturable = 3 × 510 = 1530.
    expect(presta.heuresReservees.enMinutes).toBe(1530);
    expect(presta.heuresMensualisees).toBe(126.5); // 885.5 / 7.
    expect(presta.complement.enMinutes).toBe(30);
  });

  it('crèche à cheval : semaine type par jour, mensualité du segment du 1er (H7)', () => {
    // Segment A (01→14, lundi 8h30–17h00 = 510) : lundis 05, 12.
    // Segment B (15→∞, lundi 8h30–12h30 = 240) : lundis 19, 26.
    const a = segmentCreche('2026-10-01', '2026-10-14', 17);
    const b = segmentCreche('2026-10-15', '2026-12-31', 12, {
      heuresAnnuellesContractualisees: 700,
      semaineType: {
        LUNDI: [
          { debutHeures: 8, debutMinutes: 30, finHeures: 12, finMinutes: 30 },
        ],
      },
    });
    const presta = genererPrestationMoisSegments(
      [a, b],
      MOIS,
      {},
      [],
    ) as PrestationsMoisCreche;

    // Heures réservées = 2×510 (jours 1-14) + 2×240 (jours 15-31) = 1500.
    expect(presta.heuresReservees.enMinutes).toBe(1020 + 480);
    // Mensualité H7 : celle du segment du 1er (A) = 885,5 / 7 = 126,5.
    expect(presta.heuresMensualisees).toBe(126.5);
    expect(presta.heuresAnnuellesContractualisees).toBe(885.5);
  });

  it('répartit les absences : datée → segment couvrant, sans date → mensuel', () => {
    const a = segmentCreche('2026-10-01', '2026-10-14', 17); // lundis 05, 12
    const b = segmentCreche('2026-10-15', '2026-10-31', 17); // lundis 19, 26
    const saisie: SaisiePlanningJson = {
      // Scalaire mensuel → segment mensuel (A).
      complementMinutes: 15,
      // Sans date (certificat) → segment mensuel (A) : 4h déduites.
      absences: [
        {
          debutHeures: 8,
          debutMinutes: 30,
          finHeures: 12,
          finMinutes: 30,
          preavisJours: 0,
          certificatMaladie: true,
        },
        // Datée dans B (2026-10-19, préavis 3) → 4h déduites côté B.
        {
          date: '2026-10-19',
          debutHeures: 8,
          debutMinutes: 30,
          finHeures: 12,
          finMinutes: 30,
          preavisJours: 3,
          certificatMaladie: false,
        },
      ],
      // Ajustement daté dans B (lundi 26, gardé) : présence 08:30–16:00 →
      // réduction 60 min déductible (préavis 3).
      ajustements: [
        {
          date: '2026-10-26',
          debutHeures: 8,
          debutMinutes: 30,
          finHeures: 16,
          finMinutes: 0,
          preavisJours: 3,
          certificatMaladie: false,
        },
      ],
    };
    const presta = genererPrestationMoisSegments(
      [a, b],
      MOIS,
      saisie,
      [],
    ) as PrestationsMoisCreche;
    // 240 (A, sans date) + 240 (B, datée) + 60 (B, ajustement) = 540.
    expect(presta.heuresDeduites.enMinutes).toBe(540);
    expect(presta.complement.enMinutes).toBe(15);
  });

  it('mensualité fallback quand aucun segment ne couvre le 1er du mois', () => {
    // Contrat qui débute le 10 : ni A ni B ne couvrent le 2026-10-01.
    const a = segmentCreche('2026-10-10', '2026-10-19', 17, {
      heuresAnnuellesContractualisees: 700,
    }); // lundi 12
    const b = segmentCreche('2026-10-20', '2026-10-31', 17); // lundi 26
    const presta = genererPrestationMoisSegments(
      [a, b],
      MOIS,
      {},
      [],
    ) as PrestationsMoisCreche;
    // idxMensuel = 0 (segment A) → mensualité 700 / 7 = 100.
    expect(presta.heuresMensualisees).toBe(100);
    // A couvre lundis 12 et 19 ; B couvre lundi 26 → 3 × 510.
    expect(presta.heuresReservees.enMinutes).toBe(1530);
  });

  it('item daté hors de tout segment (trou) → rattaché au segment mensuel', () => {
    const a = segmentCreche('2026-10-01', '2026-10-10', 17); // lundi 05
    const b = segmentCreche('2026-10-20', '2026-10-31', 17); // lundi 26
    const saisie: SaisiePlanningJson = {
      // 2026-10-15 tombe dans le trou (11→19) : rattaché au mensuel (A) mais hors
      // de sa période → sans effet facturable (jour ajouté ignoré).
      joursSupplementaires: [
        {
          date: '2026-10-15',
          debutHeures: 8,
          debutMinutes: 0,
          finHeures: 12,
          finMinutes: 0,
        },
      ],
    };
    const presta = genererPrestationMoisSegments(
      [a, b],
      MOIS,
      saisie,
      [],
    ) as PrestationsMoisCreche;
    expect(presta.complement.estZero()).toBe(true);
  });

  it('cantine à cheval : somme des jours, PAI mensuel', () => {
    const a = segmentAbcm('CANTINE', '2026-10-01', '2026-10-14', {
      LUNDI: { cantine: true },
    }); // lundis 05, 12
    const b = segmentAbcm('CANTINE', '2026-10-15', '2026-10-31', null); // 0
    const presta = genererPrestationMoisSegments(
      [a, b],
      MOIS,
      { pai: true },
      [],
    ) as PrestationsMoisCantine;
    expect(presta.nbJours).toBe(2);
    expect(presta.pai).toBe(true);
  });

  it('périscolaire à cheval : somme matins/soirs', () => {
    const a = segmentAbcm('PERISCOLAIRE', '2026-10-01', '2026-10-14', {
      LUNDI: { periMatin: true, periSoir: true },
    }); // lundis 05, 12
    const b = segmentAbcm('PERISCOLAIRE', '2026-10-15', '2026-10-31', {
      LUNDI: { periMatin: true },
    }); // lundis 19, 26 (matin seul)
    const presta = genererPrestationMoisSegments(
      [a, b],
      MOIS,
      // Exception datée dans A (05) : retire le matin → nbMatins 4 − 1 = 3.
      { exceptions: [{ date: '2026-10-05', periMatin: false }] },
      [],
    ) as PrestationsMoisPeriscolaire;
    expect(presta.nbMatins).toBe(3);
    expect(presta.nbSoirs).toBe(2);
  });

  it('ALSH à cheval : somme des compteurs, jours datés répartis', () => {
    const a = segmentAbcm('ALSH', '2026-10-01', '2026-10-14', {}); // vide
    const b = segmentAbcm('ALSH', '2026-10-15', '2026-10-31', {}); // vide
    const saisie: SaisiePlanningJson = {
      joursAlsh: [
        { date: '2026-10-07', type: 'COMPLETE', repas: true }, // segment A
        { date: '2026-10-21', type: 'DEMI' }, // segment B
      ],
    };
    const presta = genererPrestationMoisSegments(
      [a, b],
      MOIS,
      saisie,
      [],
    ) as PrestationsMoisAlsh;
    expect(presta.nbJourneesCompletes).toBe(1);
    expect(presta.nbDemiJournees).toBe(1);
    expect(presta.nbRepas).toBe(1);
  });
});
