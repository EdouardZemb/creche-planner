import { describe, expect, it } from 'vitest';
import { Duree } from '@creche-planner/shared-kernel';
import { ContratCreche } from './contrat-creche.js';
import { PlageHoraire } from './plage-horaire.js';
import { SemaineType } from './semaine-type.js';
import {
  DeductionExcessiveError,
  ParametreContratInvalideError,
  PeriodeContratInvalideError,
} from './planification-error.js';
import type { PrestationsMoisCreche } from './prestations-mois.types.js';

/** Semaine type crèche de Mia (doc 02 §7) : 25 h 30 / sem. */
function semaineMia(): SemaineType {
  return SemaineType.creer({
    LUNDI: [PlageHoraire.creer(8, 30, 17, 0)],
    MERCREDI: [PlageHoraire.creer(8, 30, 17, 0)],
    VENDREDI: [PlageHoraire.creer(8, 30, 17, 0)],
  });
}

/** Semaine type crèche de Zoé (doc 02 §7) : 25 h 30 / sem. */
function semaineZoé(): SemaineType {
  return SemaineType.creer({
    LUNDI: [PlageHoraire.creer(8, 30, 17, 0)],
    MERCREDI: [PlageHoraire.creer(8, 30, 17, 0)],
    VENDREDI: [PlageHoraire.creer(8, 30, 17, 0)],
  });
}

function contratMia(): ContratCreche {
  return ContratCreche.creer({
    valideDu: '2026-01-01',
    valideAu: '2026-07-31',
    heuresAnnuellesContractualisees: 885.5,
    nbMensualites: 7,
    semaineType: semaineMia(),
  });
}

function contratZoé(): ContratCreche {
  return ContratCreche.creer({
    valideDu: '2026-01-01',
    valideAu: '2026-07-31',
    heuresAnnuellesContractualisees: 831.5,
    nbMensualites: 7,
    semaineType: semaineZoé(),
  });
}

function presta(contrat: ContratCreche, mois: string, options = {}) {
  return contrat.genererPrestationsMois({
    mois,
    ...options,
  }) as PrestationsMoisCreche;
}

describe('ContratCreche — construction (invariants)', () => {
  it('rejette une période dont la fin précède le début (INV-01)', () => {
    expect(() =>
      ContratCreche.creer({
        valideDu: '2026-07-31',
        valideAu: '2026-01-01',
        heuresAnnuellesContractualisees: 885.5,
        nbMensualites: 7,
        semaineType: semaineMia(),
      }),
    ).toThrow(PeriodeContratInvalideError);
  });

  it('rejette des heures annuelles négatives (INV-01)', () => {
    expect(() =>
      ContratCreche.creer({
        valideDu: '2026-01-01',
        valideAu: '2026-07-31',
        heuresAnnuellesContractualisees: -1,
        nbMensualites: 7,
        semaineType: semaineMia(),
      }),
    ).toThrow(ParametreContratInvalideError);
  });

  it('rejette un nombre de mensualités non entier ou nul', () => {
    expect(() =>
      ContratCreche.creer({
        valideDu: '2026-01-01',
        valideAu: '2026-07-31',
        heuresAnnuellesContractualisees: 885.5,
        nbMensualites: 0,
        semaineType: semaineMia(),
      }),
    ).toThrow(ParametreContratInvalideError);
    expect(() =>
      ContratCreche.creer({
        valideDu: '2026-01-01',
        valideAu: '2026-07-31',
        heuresAnnuellesContractualisees: 885.5,
        nbMensualites: 1.5,
        semaineType: semaineMia(),
      }),
    ).toThrow(ParametreContratInvalideError);
  });

  it('rejette une date de période mal formée', () => {
    expect(() =>
      ContratCreche.creer({
        valideDu: '01/01/2026',
        valideAu: '2026-07-31',
        heuresAnnuellesContractualisees: 885.5,
        nbMensualites: 7,
        semaineType: semaineMia(),
      }),
    ).toThrow();
  });
});

describe('ContratCreche — heures mensualisées (CT-02 / CT-03)', () => {
  it('Mia : 885,50 / 7 = 126,50 h/mois', () => {
    expect(presta(contratMia(), '2026-03').heuresMensualisees).toBe(126.5);
  });

  it('Zoé : 831,50 / 7 = 118,79 h/mois (arrondi au centième)', () => {
    expect(presta(contratZoé(), '2026-03').heuresMensualisees).toBe(118.79);
  });

  it('expose le mode CRECHE_PSU et les données de mensualisation', () => {
    const p = presta(contratMia(), '2026-03');
    expect(p.mode).toBe('CRECHE_PSU');
    expect(p.heuresAnnuellesContractualisees).toBe(885.5);
    expect(p.nbMensualites).toBe(7);
  });
});

describe('ContratCreche — complément (CT-05)', () => {
  it('reporte un complément de +1 h 23 min (83 min)', () => {
    const p = presta(contratMia(), '2026-03', {
      complement: Duree.depuisMinutes(83),
    });
    expect(p.complement.enMinutes).toBe(83);
  });

  it('complément nul par défaut', () => {
    expect(presta(contratMia(), '2026-03').complement.estZero()).toBe(true);
  });
});

describe('ContratCreche — jours supplémentaires (ajout ponctuel)', () => {
  it('agrège un jour ajouté au complément du mois (dépassement)', () => {
    const p = presta(contratMia(), '2026-03', {
      joursSupplementaires: [
        { date: '2026-03-03', duree: Duree.depuisHeuresMinutes(7, 30) },
      ],
    });
    expect(p.complement.enMinutes).toBe(450);
  });

  it('cumule jour ajouté et complément libre saisi', () => {
    const p = presta(contratMia(), '2026-03', {
      complement: Duree.depuisMinutes(30),
      joursSupplementaires: [
        { date: '2026-03-03', duree: Duree.depuisHeuresMinutes(7, 0) },
      ],
    });
    expect(p.complement.enMinutes).toBe(450);
  });

  it('ignore un jour ajouté hors du mois demandé', () => {
    const p = presta(contratMia(), '2026-03', {
      joursSupplementaires: [
        { date: '2026-04-03', duree: Duree.depuisHeuresMinutes(7, 0) },
      ],
    });
    expect(p.complement.estZero()).toBe(true);
  });

  it('ignore un jour ajouté hors période de validité du contrat', () => {
    // Mia finit le 31/07/2026 ; un jour ajouté en août n est pas facturé.
    const p = presta(contratMia(), '2026-08', {
      joursSupplementaires: [
        { date: '2026-08-03', duree: Duree.depuisHeuresMinutes(7, 0) },
      ],
    });
    expect(p.complement.estZero()).toBe(true);
  });
});

describe('ContratCreche — déductions d absence (CT-06 / CT-08)', () => {
  it('retranche une absence prévenue 3 j avant (8 h)', () => {
    const p = presta(contratZoé(), '2026-03', {
      absences: [
        {
          duree: Duree.depuisHeuresMinutes(8, 0),
          preavisJours: 3,
          certificatMaladie: false,
        },
      ],
    });
    expect(p.heuresDeduites.enHeures()).toBe(8);
  });

  it('retranche une absence maladie avec certificat (16 h)', () => {
    const p = presta(contratZoé(), '2026-03', {
      absences: [
        {
          duree: Duree.depuisHeuresMinutes(16, 0),
          preavisJours: 0,
          certificatMaladie: true,
        },
      ],
    });
    expect(p.heuresDeduites.enHeures()).toBe(16);
  });

  it('ignore une absence non éligible (préavis < 2 j, sans certificat) — CT-07', () => {
    const p = presta(contratZoé(), '2026-03', {
      absences: [
        {
          duree: Duree.depuisHeuresMinutes(8, 0),
          preavisJours: 1,
          certificatMaladie: false,
        },
      ],
    });
    expect(p.heuresDeduites.estZero()).toBe(true);
  });

  it('cumule plusieurs absences éligibles', () => {
    const p = presta(contratZoé(), '2026-03', {
      absences: [
        {
          duree: Duree.depuisHeuresMinutes(8, 0),
          preavisJours: 3,
          certificatMaladie: false,
        },
        {
          duree: Duree.depuisHeuresMinutes(8, 0),
          preavisJours: 0,
          certificatMaladie: true,
        },
      ],
    });
    expect(p.heuresDeduites.enHeures()).toBe(16);
  });

  it('rejette une déduction supérieure aux heures réservées du mois (INV-05)', () => {
    expect(() =>
      presta(contratZoé(), '2026-03', {
        absences: [
          {
            duree: Duree.depuisHeuresMinutes(500, 0),
            preavisJours: 3,
            certificatMaladie: false,
          },
        ],
      }),
    ).toThrow(DeductionExcessiveError);
  });
});

describe('ContratCreche — heures réservées du mois (jours facturables)', () => {
  it('somme la semaine type sur les jours gardés du mois, hors jours non facturables (INV-04)', () => {
    // Mars 2026 sans exclusion : on vérifie que les heures réservées sont positives.
    const p = presta(contratMia(), '2026-03');
    expect(p.heuresReservees.enMinutes).toBeGreaterThan(0);
  });

  it('exclut un jour non facturable tombant un jour gardé (INV-04)', () => {
    // 2026-03-04 est un mercredi (jour gardé Mia, 8 h 30 = 510 min).
    const sans = presta(contratMia(), '2026-03').heuresReservees.enMinutes;
    const avec = presta(contratMia(), '2026-03', {
      joursNonFacturables: ['2026-03-04'],
    }).heuresReservees.enMinutes;
    expect(sans - avec).toBe(510);
  });

  it('ne compte aucune heure hors période de validité du contrat', () => {
    // Le contrat finit le 31/07/2026 ; août n est pas couvert.
    const p = presta(contratMia(), '2026-08');
    expect(p.heuresReservees.estZero()).toBe(true);
  });

  it('ne compte pas un jour non gardé même facturable', () => {
    // 2026-03-03 est un mardi (Mia non gardée le mardi).
    const sans = presta(contratMia(), '2026-03').heuresReservees.enMinutes;
    const avec = presta(contratMia(), '2026-03', {
      joursNonFacturables: ['2026-03-03'],
    }).heuresReservees.enMinutes;
    expect(sans).toBe(avec);
  });
});

describe('ContratCreche — couverture mensuelle (Phase 9, bug #2)', () => {
  it('couvreMois : vrai pour un mois dans la période', () => {
    expect(contratMia().couvreMois('2026-03')).toBe(true);
  });

  it('couvreMois : vrai pour le mois de fin partiellement couvert (juillet)', () => {
    // Mia finit le 31/07/2026 : juillet est partiellement (ici totalement) couvert.
    expect(contratMia().couvreMois('2026-07')).toBe(true);
  });

  it('couvreMois : faux pour un mois entièrement après la fin (août)', () => {
    expect(contratMia().couvreMois('2026-08')).toBe(false);
  });

  it('couvreMois : faux pour un mois entièrement après la fin (septembre)', () => {
    expect(contratMia().couvreMois('2026-09')).toBe(false);
  });

  it('couvreMois : faux pour un mois entièrement avant le début', () => {
    expect(contratMia().couvreMois('2025-12')).toBe(false);
  });

  it('couvreMois : vrai pour un mois partiellement couvert au début', () => {
    // Contrat qui commence le 15/07 : juillet partiellement couvert.
    const contrat = ContratCreche.creer({
      valideDu: '2026-07-15',
      valideAu: '2027-06-30',
      heuresAnnuellesContractualisees: 885.5,
      nbMensualites: 7,
      semaineType: semaineMia(),
    });
    expect(contrat.couvreMois('2026-07')).toBe(true);
    expect(contrat.couvreMois('2026-06')).toBe(false);
  });

  it('Mia en août : aucune mensualité ni quantité (zéro facturable)', () => {
    const p = presta(contratMia(), '2026-08');
    expect(p.mode).toBe('CRECHE_PSU');
    // heuresAnnuelles = 0 ⇒ coût PSU nul côté tarification (mensualité neutralisée).
    expect(p.heuresAnnuellesContractualisees).toBe(0);
    expect(p.heuresMensualisees).toBe(0);
    expect(p.heuresReservees.estZero()).toBe(true);
    expect(p.heuresDeduites.estZero()).toBe(true);
    expect(p.complement.estZero()).toBe(true);
  });

  it('Mia en septembre : aucune mensualité (transition crèche→école)', () => {
    const p = presta(contratMia(), '2026-09');
    expect(p.heuresAnnuellesContractualisees).toBe(0);
    expect(p.heuresMensualisees).toBe(0);
  });

  it('conserve nbMensualites pour un mois hors période (info contractuelle)', () => {
    expect(presta(contratMia(), '2026-08').nbMensualites).toBe(7);
  });

  it('un mois couvert facture toujours la mensualité lissée', () => {
    const p = presta(contratMia(), '2026-07');
    expect(p.heuresMensualisees).toBe(126.5);
    expect(p.heuresAnnuellesContractualisees).toBe(885.5);
  });
});

// Triage mutation AQ-13 (doc 27) : bornes révélées non testées par les
// mutants survivants (EqualityOperator/Regex sur la validation du contrat).
describe('ContratCreche — bornes (triage mutation AQ-13)', () => {
  it('accepte un contrat d’un seul jour et le facture (bornes incluses)', () => {
    // Tue `valideAu < valideDu` → `<=` (même jour = valide) et les deux
    // mutants d'inclusivité `iso >= valideDu` / `iso <= valideAu` : si l'une
    // des bornes devenait stricte, le mois serait « hors période » et la
    // prestation serait neutralisée (heuresAnnuelles forcées à 0).
    const contrat = ContratCreche.creer({
      valideDu: '2026-06-30',
      valideAu: '2026-06-30',
      heuresAnnuellesContractualisees: 885.5,
      nbMensualites: 7,
      semaineType: semaineMia(),
    });
    expect(presta(contrat, '2026-06').heuresAnnuellesContractualisees).toBe(
      885.5,
    );
  });

  it('rejette une date ISO encadrée de texte parasite (ancres ^ et $)', () => {
    const base = {
      heuresAnnuellesContractualisees: 885.5,
      nbMensualites: 7,
      semaineType: semaineMia(),
    };
    // Asserter le MESSAGE, pas seulement la classe : avec l'ancre `^` mutée,
    // `x2026-01-01` passe le format puis tombe dans le contrôle d'ordre de
    // période (`'2026-07-31' < 'x…'` en lexicographique) qui lève la même
    // classe — le mutant survivrait à un simple toThrow(classe).
    expect(() =>
      ContratCreche.creer({
        ...base,
        valideDu: 'x2026-01-01',
        valideAu: '2026-07-31',
      }),
    ).toThrow('dates de validité ISO attendues');
    expect(() =>
      ContratCreche.creer({
        ...base,
        valideDu: '2026-01-01',
        valideAu: '2026-07-31x',
      }),
    ).toThrow('dates de validité ISO attendues');
  });

  it('BVA — accepte 0 heure annuelle (mensualité nulle)', () => {
    const contrat = ContratCreche.creer({
      valideDu: '2026-01-01',
      valideAu: '2026-07-31',
      heuresAnnuellesContractualisees: 0,
      nbMensualites: 7,
      semaineType: semaineMia(),
    });
    expect(contrat.heuresMensualisees).toBe(0);
  });

  it('BVA — accepte une seule mensualité', () => {
    const contrat = ContratCreche.creer({
      valideDu: '2026-01-01',
      valideAu: '2026-07-31',
      heuresAnnuellesContractualisees: 885.5,
      nbMensualites: 1,
      semaineType: semaineMia(),
    });
    expect(contrat.heuresMensualisees).toBe(885.5);
  });
});
