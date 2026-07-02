import { describe, expect, it } from 'vitest';
import { PlageHoraireInvalideError } from '@creche-planner/shared-kernel';
import {
  dureeDePlage,
  genererPrestationMois,
  semaineTypeDepuisJson,
  type ContratPourGeneration,
  type SaisiePlanningJson,
} from './generation-prestations.js';
import {
  DeductionExcessiveError,
  PeriodeContratInvalideError,
} from './planification-error.js';
import type {
  PrestationsMoisAlsh,
  PrestationsMoisCantine,
  PrestationsMoisCreche,
  PrestationsMoisPeriscolaire,
} from './prestations-mois.types.js';

// Octobre 2026 : les lundis sont les 05, 12, 19 et 26 (4 lundis).
const MOIS = '2026-10';

/** Contrat crèche PSU de référence : un lundi 8h30 → 17h00 (510 min). */
function contratCreche(
  overrides: Partial<ContratPourGeneration> = {},
): ContratPourGeneration {
  return {
    mode: 'CRECHE_PSU',
    valideDu: '2026-01-01',
    valideAu: '2026-12-31',
    heuresAnnuellesContractualisees: 885.5,
    nbMensualites: 7,
    semaineType: {
      LUNDI: [
        { debutHeures: 8, debutMinutes: 30, finHeures: 17, finMinutes: 0 },
      ],
    },
    semaineAbcm: null,
    ...overrides,
  };
}

/** Contrat ABCM de référence (cantine / périscolaire / ALSH). */
function contratAbcm(
  mode: 'CANTINE' | 'PERISCOLAIRE' | 'ALSH',
  semaineAbcm: ContratPourGeneration['semaineAbcm'],
  overrides: Partial<ContratPourGeneration> = {},
): ContratPourGeneration {
  return {
    mode,
    valideDu: '2026-01-01',
    valideAu: '2026-12-31',
    heuresAnnuellesContractualisees: null,
    nbMensualites: null,
    semaineType: null,
    semaineAbcm,
    ...overrides,
  };
}

describe('dureeDePlage', () => {
  it('calcule fin − début pour une plage cohérente', () => {
    expect(
      dureeDePlage({
        debutHeures: 8,
        debutMinutes: 0,
        finHeures: 12,
        finMinutes: 30,
      }).enMinutes,
    ).toBe(270);
  });

  it('renvoie zéro si la fin égale le début', () => {
    expect(
      dureeDePlage({
        debutHeures: 9,
        debutMinutes: 0,
        finHeures: 9,
        finMinutes: 0,
      }).estZero(),
    ).toBe(true);
  });

  it('renvoie zéro si la fin précède le début (au lieu de lever)', () => {
    expect(
      dureeDePlage({
        debutHeures: 14,
        debutMinutes: 15,
        finHeures: 9,
        finMinutes: 45,
      }).estZero(),
    ).toBe(true);
  });
});

describe('semaineTypeDepuisJson', () => {
  it('reconstruit une semaine vide depuis un JSON vide', () => {
    const semaine = semaineTypeDepuisJson({});
    expect(semaine.joursGardes).toEqual([]);
    expect(semaine.dureeJour('LUNDI').estZero()).toBe(true);
  });

  it('reconstruit les plages de chaque jour (durées sommées par jour)', () => {
    const semaine = semaineTypeDepuisJson({
      LUNDI: [
        { debutHeures: 8, debutMinutes: 30, finHeures: 12, finMinutes: 0 },
        { debutHeures: 13, debutMinutes: 0, finHeures: 17, finMinutes: 0 },
      ],
      MARDI: [
        { debutHeures: 9, debutMinutes: 0, finHeures: 16, finMinutes: 30 },
      ],
    });
    expect(semaine.joursGardes).toEqual(['LUNDI', 'MARDI']);
    expect(semaine.dureeJour('LUNDI').enMinutes).toBe(210 + 240);
    expect(semaine.dureeJour('MARDI').enMinutes).toBe(450);
  });

  it('lève PlageHoraireInvalideError (message INV-01) sur une plage fin ≤ début', () => {
    const reconstruire = (): unknown =>
      semaineTypeDepuisJson({
        LUNDI: [
          { debutHeures: 9, debutMinutes: 0, finHeures: 9, finMinutes: 0 },
        ],
      });
    expect(reconstruire).toThrowError(PlageHoraireInvalideError);
    expect(reconstruire).toThrowError(
      'la fin (540) doit être strictement postérieure au début (540)',
    );
  });
});

describe('genererPrestationMois (crèche PSU)', () => {
  it('mappe la saisie complète : complément + jours sup cohérents, absences, jours non facturables', () => {
    const saisie: SaisiePlanningJson = {
      complementMinutes: 30,
      joursSupplementaires: [
        // mardi 06 hors semaine type → +4h (240 min) au complément.
        {
          date: '2026-10-06',
          debutHeures: 8,
          debutMinutes: 0,
          finHeures: 12,
          finMinutes: 0,
        },
        // Plage incohérente (fin = début) → durée nulle, filtrée sans effet.
        {
          date: '2026-10-07',
          debutHeures: 9,
          debutMinutes: 0,
          finHeures: 9,
          finMinutes: 0,
        },
      ],
      absences: [
        // Datée, préavis ≥ 2 → 4h (240 min) déduites.
        {
          date: '2026-10-05',
          debutHeures: 8,
          debutMinutes: 30,
          finHeures: 12,
          finMinutes: 30,
          preavisJours: 3,
          certificatMaladie: false,
        },
        // Non éligible (préavis < 2, sans certificat) → rien de déduit.
        {
          date: '2026-10-19',
          debutHeures: 8,
          debutMinutes: 30,
          finHeures: 12,
          finMinutes: 30,
          preavisJours: 0,
          certificatMaladie: false,
        },
      ],
    };

    const presta = genererPrestationMois(contratCreche(), MOIS, saisie, [
      '2026-10-12', // lundi non facturable → retiré des heures réservées.
    ]) as PrestationsMoisCreche;

    expect(presta.mode).toBe('CRECHE_PSU');
    expect(presta.heuresAnnuellesContractualisees).toBe(885.5);
    expect(presta.nbMensualites).toBe(7);
    expect(presta.heuresMensualisees).toBe(126.5); // 885.5 / 7.
    expect(presta.complement.enMinutes).toBe(30 + 240);
    // 4 lundis × 510 min − le 12 non facturable = 3 × 510.
    expect(presta.heuresReservees.enMinutes).toBe(1530);
    expect(presta.heuresDeduites.enMinutes).toBe(240);
  });

  it('applique les défauts (colonnes null, saisie vide) : quantités nulles, 1 mensualité', () => {
    const contrat = contratCreche({
      valideDu: '2026-10-01',
      valideAu: null, // → période réduite au jour de début.
      heuresAnnuellesContractualisees: null, // → 0.
      nbMensualites: null, // → 1.
      semaineType: null, // → semaine vide.
    });

    const presta = genererPrestationMois(
      contrat,
      MOIS,
      {},
      [],
    ) as PrestationsMoisCreche;

    expect(presta.mode).toBe('CRECHE_PSU');
    expect(presta.heuresAnnuellesContractualisees).toBe(0);
    expect(presta.nbMensualites).toBe(1);
    expect(presta.heuresMensualisees).toBe(0);
    expect(presta.complement.estZero()).toBe(true);
    expect(presta.heuresReservees.estZero()).toBe(true);
    expect(presta.heuresDeduites.estZero()).toBe(true);
  });

  it('déduit une absence sans date, éligible par certificat maladie', () => {
    const saisie: SaisiePlanningJson = {
      absences: [
        {
          debutHeures: 8,
          debutMinutes: 30,
          finHeures: 12,
          finMinutes: 30,
          preavisJours: 0,
          certificatMaladie: true,
        },
      ],
    };

    const presta = genererPrestationMois(
      contratCreche(),
      MOIS,
      saisie,
      [],
    ) as PrestationsMoisCreche;

    expect(presta.heuresDeduites.enMinutes).toBe(240);
  });

  it('propage PeriodeContratInvalideError (message INV-01) si la fin précède le début', () => {
    const contrat = contratCreche({
      valideDu: '2026-12-31',
      valideAu: '2026-01-01',
    });
    const generer = (): unknown => genererPrestationMois(contrat, MOIS, {}, []);
    expect(generer).toThrowError(PeriodeContratInvalideError);
    expect(generer).toThrowError(
      'fin de validité (2026-01-01) antérieure au début (2026-12-31) (INV-01)',
    );
  });

  it('propage DeductionExcessiveError (message INV-05) si les déductions dépassent les heures réservées', () => {
    const saisie: SaisiePlanningJson = {
      absences: [
        {
          date: '2026-10-05',
          debutHeures: 8,
          debutMinutes: 0,
          finHeures: 23,
          finMinutes: 0,
          preavisJours: 5,
          certificatMaladie: false,
        },
      ],
    };
    // Tous les lundis non facturables → 0 h réservée, 15 h déduites.
    const generer = (): unknown =>
      genererPrestationMois(contratCreche(), MOIS, saisie, [
        '2026-10-05',
        '2026-10-12',
        '2026-10-19',
        '2026-10-26',
      ]);
    expect(generer).toThrowError(DeductionExcessiveError);
    expect(generer).toThrowError(
      'heures déduites (15) > heures réservées du mois (0) (INV-05)',
    );
  });
});

describe('genererPrestationMois (cantine)', () => {
  it('compte les jours de la semaine type, PAI faux par défaut (sans exception)', () => {
    const presta = genererPrestationMois(
      contratAbcm('CANTINE', { LUNDI: { cantine: true } }),
      MOIS,
      {},
      [],
    ) as PrestationsMoisCantine;

    expect(presta.mode).toBe('CANTINE');
    expect(presta.nbJours).toBe(4); // 4 lundis d'octobre 2026.
    expect(presta.pai).toBe(false);
  });

  it('relaye le PAI saisi', () => {
    const presta = genererPrestationMois(
      contratAbcm('CANTINE', { LUNDI: { cantine: true } }),
      MOIS,
      { pai: true },
      [],
    ) as PrestationsMoisCantine;

    expect(presta.pai).toBe(true);
  });

  it('applique une exception cantine:false (retire un jour prévu)', () => {
    const presta = genererPrestationMois(
      contratAbcm('CANTINE', { LUNDI: { cantine: true } }),
      MOIS,
      { exceptions: [{ date: '2026-10-05', cantine: false }] },
      [],
    ) as PrestationsMoisCantine;

    expect(presta.nbJours).toBe(3);
  });

  it('semaine ABCM null → vide ; une exception cantine:true ajoute un jour', () => {
    const presta = genererPrestationMois(
      contratAbcm('CANTINE', null),
      MOIS,
      { exceptions: [{ date: '2026-10-05', cantine: true }] },
      [],
    ) as PrestationsMoisCantine;

    expect(presta.nbJours).toBe(1);
  });

  it('valideAu borne la facturation : les jours du mois après la fin sont exclus', () => {
    const presta = genererPrestationMois(
      contratAbcm(
        'CANTINE',
        { LUNDI: { cantine: true } },
        { valideAu: '2026-10-12' },
      ),
      MOIS,
      {},
      [],
    ) as PrestationsMoisCantine;

    // Lundis d'octobre 2026 : 05, 12, 19, 26 — seuls 05 et 12 sont ≤ valideAu.
    expect(presta.nbJours).toBe(2);
  });

  it('valideAu null → période ouverte : les jours du mois restent facturables', () => {
    const presta = genererPrestationMois(
      contratAbcm('CANTINE', { LUNDI: { cantine: true } }, { valideAu: null }),
      MOIS,
      {},
      [],
    ) as PrestationsMoisCantine;

    expect(presta.nbJours).toBe(4);
  });
});

describe('genererPrestationMois (périscolaire)', () => {
  it('compte matins/soirs, exceptions par champ (retraits ponctuels)', () => {
    const presta = genererPrestationMois(
      contratAbcm('PERISCOLAIRE', {
        LUNDI: { periMatin: true, periSoir: true },
      }),
      MOIS,
      {
        exceptions: [
          { date: '2026-10-05', periMatin: false }, // periSoir hérite (reste compté).
          { date: '2026-10-12', periSoir: false }, // periMatin hérite (reste compté).
        ],
      },
      [],
    ) as PrestationsMoisPeriscolaire;

    expect(presta.mode).toBe('PERISCOLAIRE');
    expect(presta.nbMatins).toBe(3); // 4 lundis − le 05 retiré.
    expect(presta.nbSoirs).toBe(3); // 4 lundis − le 12 retiré.
  });
});

describe('genererPrestationMois (ALSH)', () => {
  it('compte journées complètes, demi-journées et repas saisis', () => {
    const presta = genererPrestationMois(
      contratAbcm('ALSH', {}),
      MOIS,
      {
        joursAlsh: [
          { date: '2026-10-07', type: 'COMPLETE', repas: true },
          { date: '2026-10-14', type: 'DEMI' },
        ],
      },
      [],
    ) as PrestationsMoisAlsh;

    expect(presta.mode).toBe('ALSH');
    expect(presta.nbJourneesCompletes).toBe(1);
    expect(presta.nbDemiJournees).toBe(1);
    expect(presta.nbRepas).toBe(1);
  });

  it('saisie vide → aucune quantité', () => {
    const presta = genererPrestationMois(
      contratAbcm('ALSH', {}),
      MOIS,
      {},
      [],
    ) as PrestationsMoisAlsh;

    expect(presta.nbJourneesCompletes).toBe(0);
    expect(presta.nbDemiJournees).toBe(0);
    expect(presta.nbRepas).toBe(0);
  });
});
