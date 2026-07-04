import { describe, expect, it } from 'vitest';
import { InscriptionAbcm } from './inscription-abcm.js';

/**
 * Semaine type ABCM de Zoé (doc 02 §4/§7) : cantine lundi/mercredi/vendredi,
 * péri soir ces mêmes jours, péri matin lundi/vendredi.
 */
function inscriptionZoé(): InscriptionAbcm {
  return InscriptionAbcm.creer({
    semaine: {
      LUNDI: { cantine: true, periMatin: true, periSoir: true },
      MERCREDI: { cantine: true, periMatin: false, periSoir: true },
      VENDREDI: { cantine: true, periMatin: true, periSoir: true },
    },
  });
}

describe('InscriptionAbcm — cantine (CT-10)', () => {
  it('compte les jours de cantine réservés du mois (réservé = facturé)', () => {
    const presta = inscriptionZoé().genererPrestationsCantine({
      mois: '2026-09',
    });
    expect(presta.mode).toBe('CANTINE');
    expect(presta.pai).toBe(false);
    // Sept. 2026 jours de cantine : lundis 7,14,21,28 (4) + mercredis 2,9,16,23,30 (5)
    // + vendredis 4,11,18,25 (4) = 13 jours.
    expect(presta.nbJours).toBe(13);
  });

  it('retrouve l oracle 12 jours sur 4 semaines pleines (jours non facturables) — CT-10', () => {
    // Sept. 2026 a 5 mercredis (2,9,16,23,30) ; en excluant le mercredi 30 on
    // ramène à 4 occurrences de chaque jour de cantine, soit 3 jours/sem × 4 sem = 12.
    const presta = inscriptionZoé().genererPrestationsCantine({
      mois: '2026-09',
      joursNonFacturables: ['2026-09-30'],
    });
    expect(presta.nbJours).toBe(12);
  });

  it('exclut un jour de cantine non facturable (INV-04)', () => {
    const reference = inscriptionZoé().genererPrestationsCantine({
      mois: '2026-09',
    });
    const avecExclusion = inscriptionZoé().genererPrestationsCantine({
      mois: '2026-09',
      joursNonFacturables: ['2026-09-07'], // un lundi (jour de cantine)
    });
    expect(reference.nbJours - avecExclusion.nbJours).toBe(1);
  });

  it('reporte le drapeau PAI', () => {
    const presta = inscriptionZoé().genererPrestationsCantine({
      mois: '2026-09',
      pai: true,
    });
    expect(presta.pai).toBe(true);
  });
});

describe('InscriptionAbcm — exceptions par jour (ajout / retrait ponctuel)', () => {
  it('retire un jour de cantine prévu (exception cantine=false)', () => {
    const presta = inscriptionZoé().genererPrestationsCantine({
      mois: '2026-09',
      exceptions: [{ date: '2026-09-07', cantine: false }], // un lundi prévu
    });
    expect(presta.nbJours).toBe(12); // 13 − 1
  });

  it('ajoute un jour de cantine non prévu (exception cantine=true)', () => {
    // Jeudi 2026-09-03 : non inscrit dans la semaine type → ajout ponctuel.
    const presta = inscriptionZoé().genererPrestationsCantine({
      mois: '2026-09',
      exceptions: [{ date: '2026-09-03', cantine: true }],
    });
    expect(presta.nbJours).toBe(14); // 13 + 1
  });

  it('un champ absent de l exception hérite de la semaine type', () => {
    // L exception ne porte que periSoir : la cantine du lundi reste comptée.
    const presta = inscriptionZoé().genererPrestationsCantine({
      mois: '2026-09',
      exceptions: [{ date: '2026-09-07', periSoir: false }],
    });
    expect(presta.nbJours).toBe(13);
  });

  it('périscolaire : retire un matin et ajoute un soir ponctuellement', () => {
    const reference = inscriptionZoé().genererPrestationsPeriscolaire({
      mois: '2026-09',
      joursNonFacturables: ['2026-09-01'],
    });
    const ajuste = inscriptionZoé().genererPrestationsPeriscolaire({
      mois: '2026-09',
      joursNonFacturables: ['2026-09-01'],
      exceptions: [
        { date: '2026-09-07', periMatin: false }, // lundi : retire le matin
        { date: '2026-09-03', periSoir: true }, // jeudi : ajoute un soir
      ],
    });
    expect(reference.nbMatins - ajuste.nbMatins).toBe(1);
    expect(ajuste.nbSoirs - reference.nbSoirs).toBe(1);
  });

  it('ignore une exception sur un jour non facturable (INV-04 prévaut)', () => {
    const presta = inscriptionZoé().genererPrestationsCantine({
      mois: '2026-09',
      joursNonFacturables: ['2026-09-01'],
      exceptions: [{ date: '2026-09-01', cantine: true }],
    });
    expect(presta.nbJours).toBe(13); // le jour non facturable n est jamais facturé
  });
});

describe('InscriptionAbcm — périscolaire (CT-11)', () => {
  it('compte séances soir et matin du mois', () => {
    const presta = inscriptionZoé().genererPrestationsPeriscolaire({
      mois: '2026-09',
      joursNonFacturables: ['2026-09-30'],
    });
    expect(presta.mode).toBe('PERISCOLAIRE');
    // Soir lun/mer/ven, en excluant le mercredi 30 → 3 jours × 4 sem = 12 ;
    // matin lundi+vendredi × 4 sem = 8.
    expect(presta.nbSoirs).toBe(12);
    expect(presta.nbMatins).toBe(8);
  });

  it('exclut une séance dont le jour est non facturable (INV-04)', () => {
    const reference = inscriptionZoé().genererPrestationsPeriscolaire({
      mois: '2026-09',
    });
    const avec = inscriptionZoé().genererPrestationsPeriscolaire({
      mois: '2026-09',
      joursNonFacturables: ['2026-09-07'], // lundi : matin + soir
    });
    expect(reference.nbMatins - avec.nbMatins).toBe(1);
    expect(reference.nbSoirs - avec.nbSoirs).toBe(1);
  });
});

describe('InscriptionAbcm — ALSH (CT-12)', () => {
  it('compte 5 journées complètes ALSH (vacances)', () => {
    const inscription = InscriptionAbcm.creer({ semaine: {} });
    const presta = inscription.genererPrestationsAlsh({
      mois: '2026-10',
      joursAlsh: [
        { date: '2026-10-19', type: 'COMPLETE' },
        { date: '2026-10-20', type: 'COMPLETE' },
        { date: '2026-10-21', type: 'COMPLETE' },
        { date: '2026-10-22', type: 'COMPLETE' },
        { date: '2026-10-23', type: 'COMPLETE' },
      ],
    });
    expect(presta.mode).toBe('ALSH');
    expect(presta.nbJourneesCompletes).toBe(5);
    expect(presta.nbDemiJournees).toBe(0);
    expect(presta.nbRepas).toBe(0);
  });

  it('compte demi-journées et repas', () => {
    const presta = InscriptionAbcm.creer({
      semaine: {},
    }).genererPrestationsAlsh({
      mois: '2026-10',
      joursAlsh: [
        { date: '2026-10-19', type: 'COMPLETE', repas: true },
        { date: '2026-10-20', type: 'DEMI' },
      ],
    });
    expect(presta.nbJourneesCompletes).toBe(1);
    expect(presta.nbDemiJournees).toBe(1);
    expect(presta.nbRepas).toBe(1);
  });

  it('exclut un jour ALSH non facturable (INV-04)', () => {
    const presta = InscriptionAbcm.creer({
      semaine: {},
    }).genererPrestationsAlsh({
      mois: '2026-10',
      joursAlsh: [
        { date: '2026-10-19', type: 'COMPLETE' },
        { date: '2026-10-20', type: 'COMPLETE' },
      ],
      joursNonFacturables: ['2026-10-20'],
    });
    expect(presta.nbJourneesCompletes).toBe(1);
  });

  it('ignore un jour ALSH hors du mois demandé', () => {
    const presta = InscriptionAbcm.creer({
      semaine: {},
    }).genererPrestationsAlsh({
      mois: '2026-10',
      joursAlsh: [
        { date: '2026-10-19', type: 'COMPLETE' },
        { date: '2026-11-02', type: 'COMPLETE' }, // novembre : ignoré
      ],
    });
    expect(presta.nbJourneesCompletes).toBe(1);
  });
});

/** Inscription ALSH récurrente : tous les mercredis, journée complète + repas. */
function inscriptionMercredis(): InscriptionAbcm {
  return InscriptionAbcm.creer({
    semaine: {
      MERCREDI: { alsh: { type: 'COMPLETE', repas: true } },
    },
  });
}

describe('InscriptionAbcm — ALSH hebdomadaire (semaine type)', () => {
  it('génère un jour ALSH par mercredi du mois (récurrence seule)', () => {
    const presta = inscriptionMercredis().genererPrestationsAlsh({
      mois: '2026-09',
      joursAlsh: [],
    });
    // Sept. 2026 : mercredis 2, 9, 16, 23, 30 = 5 journées complètes + repas.
    expect(presta.nbJourneesCompletes).toBe(5);
    expect(presta.nbDemiJournees).toBe(0);
    expect(presta.nbRepas).toBe(5);
  });

  it('un jour explicite prime sur la récurrence pour la même date (pas de double comptage)', () => {
    const presta = inscriptionMercredis().genererPrestationsAlsh({
      mois: '2026-09',
      // Le mercredi 16 est réservé explicitement en demi-journée sans repas :
      // sa formule remplace celle de la récurrence, il ne compte qu'une fois.
      joursAlsh: [{ date: '2026-09-16', type: 'DEMI' }],
    });
    expect(presta.nbJourneesCompletes).toBe(4);
    expect(presta.nbDemiJournees).toBe(1);
    expect(presta.nbRepas).toBe(4);
  });

  it('cumule récurrence et jours explicites de dates différentes (vacances)', () => {
    const presta = inscriptionMercredis().genererPrestationsAlsh({
      mois: '2026-09',
      joursAlsh: [{ date: '2026-09-03', type: 'COMPLETE', repas: true }], // un jeudi
    });
    expect(presta.nbJourneesCompletes).toBe(6);
    expect(presta.nbRepas).toBe(6);
  });

  it('exception alsh=false : retire un mercredi de la récurrence', () => {
    const presta = inscriptionMercredis().genererPrestationsAlsh({
      mois: '2026-09',
      joursAlsh: [],
      exceptions: [{ date: '2026-09-09', alsh: false }],
    });
    expect(presta.nbJourneesCompletes).toBe(4);
    expect(presta.nbRepas).toBe(4);
  });

  it('exception alsh=true : ajoute un jour hors récurrence (journée complète par défaut)', () => {
    const presta = inscriptionMercredis().genererPrestationsAlsh({
      mois: '2026-09',
      joursAlsh: [],
      exceptions: [{ date: '2026-09-03', alsh: true }], // un jeudi
    });
    expect(presta.nbJourneesCompletes).toBe(6);
    // Le jour ajouté hérite du défaut (pas de repas), pas de la config du mercredi.
    expect(presta.nbRepas).toBe(5);
  });

  it('exclut un mercredi non facturable de la récurrence (INV-04)', () => {
    const presta = inscriptionMercredis().genererPrestationsAlsh({
      mois: '2026-09',
      joursAlsh: [],
      joursNonFacturables: ['2026-09-30'],
    });
    expect(presta.nbJourneesCompletes).toBe(4);
  });

  it('ne génère la récurrence que dans la période de validité', () => {
    const inscription = InscriptionAbcm.creer({
      semaine: { MERCREDI: { alsh: { type: 'DEMI' } } },
      valideDu: '2026-09-15',
    });
    const presta = inscription.genererPrestationsAlsh({
      mois: '2026-09',
      joursAlsh: [],
    });
    // Mercredis ≥ 15/09 : 16, 23, 30.
    expect(presta.nbDemiJournees).toBe(3);
    expect(presta.nbRepas).toBe(0);
  });

  it('sans inscription hebdomadaire : comportement par dates inchangé', () => {
    const presta = InscriptionAbcm.creer({
      semaine: { MERCREDI: { cantine: true } }, // cantine ≠ alsh : sans effet ALSH
    }).genererPrestationsAlsh({
      mois: '2026-09',
      joursAlsh: [{ date: '2026-09-02', type: 'COMPLETE' }],
    });
    expect(presta.nbJourneesCompletes).toBe(1);
    expect(presta.nbDemiJournees).toBe(0);
  });
});

/** Inscription Zoé valide à partir de la rentrée (01/09/2026, doc 02 §8). */
function inscriptionZoéRentree(): InscriptionAbcm {
  return InscriptionAbcm.creer({
    semaine: {
      LUNDI: { cantine: true, periMatin: true, periSoir: true },
      MERCREDI: { cantine: true, periMatin: false, periSoir: true },
      VENDREDI: { cantine: true, periMatin: true, periSoir: true },
    },
    valideDu: '2026-09-01',
    valideAu: '2027-08-31',
  });
}

describe('InscriptionAbcm — couverture mensuelle (Phase 9, bug #2)', () => {
  it('couvreMois : faux pour un mois entièrement avant la rentrée (juin)', () => {
    expect(inscriptionZoéRentree().couvreMois('2026-06')).toBe(false);
  });

  it('couvreMois : vrai pour le mois de rentrée (septembre)', () => {
    expect(inscriptionZoéRentree().couvreMois('2026-09')).toBe(true);
  });

  it('couvreMois : faux pour un mois entièrement après valideAu', () => {
    // Inscription se terminant le 31/08/2027 : septembre 2027 hors période.
    expect(inscriptionZoéRentree().couvreMois('2027-09')).toBe(false);
  });

  it('cantine : zéro jour après la fin de validité (valideAu)', () => {
    const presta = inscriptionZoéRentree().genererPrestationsCantine({
      mois: '2027-09',
    });
    expect(presta.nbJours).toBe(0);
  });

  it('couvreMois : vrai sans bornes de validité (toute date couverte)', () => {
    expect(InscriptionAbcm.creer({ semaine: {} }).couvreMois('2026-06')).toBe(
      true,
    );
  });

  it('Zoé cantine en juin : zéro jour (avant la rentrée)', () => {
    const presta = inscriptionZoéRentree().genererPrestationsCantine({
      mois: '2026-06',
    });
    expect(presta.nbJours).toBe(0);
  });

  it('Zoé péri en juin : zéro séance (avant la rentrée)', () => {
    const presta = inscriptionZoéRentree().genererPrestationsPeriscolaire({
      mois: '2026-06',
    });
    expect(presta.nbMatins).toBe(0);
    expect(presta.nbSoirs).toBe(0);
  });

  it('Zoé cantine en septembre : facturée normalement (13 jours)', () => {
    const presta = inscriptionZoéRentree().genererPrestationsCantine({
      mois: '2026-09',
    });
    expect(presta.nbJours).toBe(13);
  });

  it('mois partiellement couvert : ne compte que les jours dans la période', () => {
    // Inscription valide à partir du 15/09/2026 : seuls les jours ≥ 15 comptent.
    const inscription = InscriptionAbcm.creer({
      semaine: {
        LUNDI: { cantine: true },
        MERCREDI: { cantine: true },
        VENDREDI: { cantine: true },
      },
      valideDu: '2026-09-15',
    });
    const presta = inscription.genererPrestationsCantine({
      mois: '2026-09',
    });
    // Jours de cantine ≥ 15 : lun 21,28 ; mer 16,23,30 ; ven 18,25 = 7.
    expect(presta.nbJours).toBe(7);
  });

  it('ALSH : ignore un jour hors période de validité', () => {
    const inscription = InscriptionAbcm.creer({
      semaine: {},
      valideDu: '2026-10-20',
    });
    const presta = inscription.genererPrestationsAlsh({
      mois: '2026-10',
      joursAlsh: [
        { date: '2026-10-19', type: 'COMPLETE' }, // avant valideDu : ignoré
        { date: '2026-10-21', type: 'COMPLETE' },
      ],
    });
    expect(presta.nbJourneesCompletes).toBe(1);
  });
});
