// MBT — DT-07 + BVA-13/14/15/16 + Monotonie + Bornage (Decision Table, BVA 3 points, property-based) ;
// Critère : combinatoire complète (bornes ressources) + BVA 3 points (plancher/plafond) + property-based (monotonie, bornage) ;
// Traçabilité doc 17 ; SUT : psu/tarif-creche-psu.ts
import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { Duree, Money } from '@creche-planner/shared-kernel';
import { TarifCrechePsu } from './tarif-creche-psu.js';
import { BaremeEffortPsu } from './bareme-effort-psu.js';

/**
 * Modèle DT-07 — bornage des ressources (tarif-creche-psu.ts L135-149).
 *
 * Le tarif horaire est calculé sur la ressource *appliquée* :
 *   - plafond défini ET ressource > plafond  ⇒ plafond
 *   - plancher défini ET ressource < plancher ⇒ plancher
 *   - sinon                                   ⇒ ressource
 * (le plafond est testé en premier, cf. ordre des `if`).
 */

const TAUX_2 = 0.000516; // taux d'effort, 2 enfants (barème 2026)

/** Centimes attendus pour le tarif horaire = ressources appliquées × taux (arrondi centime). */
function tarifHoraireCentimes(
  ressourcesCentimes: number,
  taux = TAUX_2,
): number {
  return Math.round(ressourcesCentimes * taux);
}

function tarif(opts: {
  ressources: Money;
  plancher?: Money;
  plafond?: Money;
}): TarifCrechePsu {
  return new TarifCrechePsu({
    ressourcesMensuelles: opts.ressources,
    nbEnfantsACharge: 2,
    // exactOptionalPropertyTypes : omettre la clé plutôt que passer `undefined`.
    ...(opts.plancher !== undefined ? { plancher: opts.plancher } : {}),
    ...(opts.plafond !== undefined ? { plafond: opts.plafond } : {}),
  });
}

describe('MBT DT-07 — PSU ressources bornées (table de décision + BVA 3 points)', () => {
  const PLANCHER = Money.depuisEuros(800); // 80000 centimes
  const PLAFOND = Money.depuisEuros(6000); // 600000 centimes

  // -- Table de décision : 3 règles principales -----------------------------
  it('R1 — aucune borne définie ⇒ ressource appliquée telle quelle', () => {
    const r = Money.depuisEuros(2500);
    expect(tarif({ ressources: r }).tarifHoraire.centimes).toBe(
      tarifHoraireCentimes(250000),
    );
  });

  it('R2 — ressource sous plancher ⇒ plancher appliqué', () => {
    const r = Money.depuisEuros(500); // < plancher 800
    const obtenu = tarif({ ressources: r, plancher: PLANCHER }).tarifHoraire;
    expect(obtenu.centimes).toBe(tarifHoraireCentimes(80000));
  });

  it('R3 — ressource au-dessus plafond ⇒ plafond appliqué', () => {
    const r = Money.depuisEuros(99999); // > plafond 6000
    const obtenu = tarif({ ressources: r, plafond: PLAFOND }).tarifHoraire;
    expect(obtenu.centimes).toBe(tarifHoraireCentimes(600000));
  });

  it('R2 bis — sous plancher mais plancher non défini ⇒ ressource brute', () => {
    const r = Money.depuisEuros(500);
    expect(tarif({ ressources: r }).tarifHoraire.centimes).toBe(
      tarifHoraireCentimes(50000),
    );
  });

  it('R3 bis — au-dessus plafond mais plafond non défini ⇒ ressource brute', () => {
    const r = Money.depuisEuros(99999);
    expect(tarif({ ressources: r }).tarifHoraire.centimes).toBe(
      tarifHoraireCentimes(9999900),
    );
  });

  // -- BVA 3 points au PLANCHER (plancher−ε / plancher / plancher+ε) --------
  describe('BVA 3 points au plancher (ε = 1 centime)', () => {
    const cas: readonly [string, number, number][] = [
      // [libellé, ressource centimes, ressource appliquée centimes]
      ['plancher − ε ⇒ plancher', 80000 - 1, 80000],
      ['plancher exact ⇒ ressource (pas borné)', 80000, 80000],
      ['plancher + ε ⇒ ressource', 80000 + 1, 80000 + 1],
    ];
    it.each(cas)('%s', (_l, rc, appliquee) => {
      const obtenu = tarif({
        ressources: Money.depuisCentimes(rc),
        plancher: PLANCHER,
      }).tarifHoraire;
      expect(obtenu.centimes).toBe(tarifHoraireCentimes(appliquee));
    });
  });

  // -- BVA 3 points au PLAFOND (plafond−ε / plafond / plafond+ε) ------------
  describe('BVA 3 points au plafond (ε = 1 centime)', () => {
    const cas: readonly [string, number, number][] = [
      ['plafond − ε ⇒ ressource', 600000 - 1, 600000 - 1],
      ['plafond exact ⇒ ressource (pas borné)', 600000, 600000],
      ['plafond + ε ⇒ plafond', 600000 + 1, 600000],
    ];
    it.each(cas)('%s', (_l, rc, appliquee) => {
      const obtenu = tarif({
        ressources: Money.depuisCentimes(rc),
        plafond: PLAFOND,
      }).tarifHoraire;
      expect(obtenu.centimes).toBe(tarifHoraireCentimes(appliquee));
    });
  });
});

describe('MBT BVA-13 — tarif horaire = ressources × taux (points limites)', () => {
  it('ressources nulles ⇒ tarif horaire nul', () => {
    expect(tarif({ ressources: Money.zero() }).tarifHoraire.estZero()).toBe(
      true,
    );
  });

  it('valeur réelle du foyer (6 716,92 €, 2 enfants) ⇒ 3,47 €/h', () => {
    expect(
      tarif({ ressources: Money.depuisEuros(6716.92) }).tarifHoraire.centimes,
    ).toBe(347);
  });

  it('arrondi au centième près (671 692 ct × 0,000516 = 346,59 → 347 ct)', () => {
    // démontre l'arrondi Math.round du produit
    expect(tarifHoraireCentimes(671692)).toBe(347);
  });
});

describe('MBT BVA-14 — mensualité (heures annuelles / nbMensualités, arrondi centième)', () => {
  function mensualiteCentimes(heuresAnnuelles: number, nbMens: number): number {
    const t = tarif({ ressources: Money.depuisEuros(6716.92) });
    return t.calculerCoutMois({
      heuresAnnuellesContractualisees: heuresAnnuelles,
      nbMensualites: nbMens,
    }).total.centimes;
  }

  it('heures annuelles = 0 ⇒ mensualité nulle', () => {
    expect(mensualiteCentimes(0, 7)).toBe(0);
  });

  it('valeur réelle Mia (885,50 h / 7) ⇒ 438,96 €', () => {
    // 885.5/7 = 126.5 (arrondi centième), × 3,47 = 438,955 → 438,96
    expect(mensualiteCentimes(885.5, 7)).toBe(43896);
  });

  it('arrondi au centième sur les heures mensualisées (100/3 = 33,33 h)', () => {
    // 100/7 ? non : on prend 100/3 pour forcer l'arrondi : 33.333 → 33.33
    const t = tarif({ ressources: Money.depuisEuros(6716.92) });
    const cout = t.calculerCoutMois({
      heuresAnnuellesContractualisees: 100,
      nbMensualites: 3,
    });
    // 33,33 h × 347 ct = 11565,51 → round 11566
    expect(cout.total.centimes).toBe(Math.round(33.33 * 347));
  });
});

describe('MBT BVA-15 — complément (Durée × tarif horaire)', () => {
  const t = () => tarif({ ressources: Money.depuisEuros(6716.92) });

  it('complément nul ⇒ aucune ligne de complément', () => {
    const cout = t().calculerCoutMois({
      heuresAnnuellesContractualisees: 885.5,
      nbMensualites: 7,
      complement: Duree.zero(),
    });
    expect(cout.lignes).toHaveLength(1);
  });

  it('complément 83 min (1 h 23) ⇒ +4,80 € sur la mensualité', () => {
    const cout = t().calculerCoutMois({
      heuresAnnuellesContractualisees: 885.5,
      nbMensualites: 7,
      complement: Duree.depuisMinutes(83),
    });
    expect(cout.total.centimes).toBe(44376);
  });

  it('complément 1 min ⇒ ligne ajoutée (point limite minimal)', () => {
    const cout = t().calculerCoutMois({
      heuresAnnuellesContractualisees: 885.5,
      nbMensualites: 7,
      complement: Duree.depuisMinutes(1),
    });
    expect(cout.lignes).toHaveLength(2);
  });
});

describe('MBT BVA-16 — déductions (cumul absences éligibles)', () => {
  const t = () => tarif({ ressources: Money.depuisEuros(6716.92) });

  it('aucune absence ⇒ pas de ligne de crédit', () => {
    const cout = t().calculerCoutMois({
      heuresAnnuellesContractualisees: 831.5,
      nbMensualites: 7,
    });
    expect(cout.lignes.some((l) => l.estCredit())).toBe(false);
  });

  it('cumul de 2 absences avec certificat (2 × 8 h) ⇒ une seule ligne de déduction', () => {
    const cout = t().calculerCoutMois({
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
    const credits = cout.lignes.filter((l) => l.estCredit());
    expect(credits).toHaveLength(1);
    expect(cout.total.centimes).toBe(35668);
  });

  it('absence non éligible (préavis 1 j, sans certificat) ⇒ non déduite', () => {
    const cout = t().calculerCoutMois({
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
    expect(cout.lignes.some((l) => l.estCredit())).toBe(false);
  });
});

describe('MBT property-based — bornage : ressource appliquée ∈ [plancher, plafond]', () => {
  it('le tarif horaire reflète une ressource appliquée comprise dans [plancher, plafond]', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: 2_000_000 }), // ressource brute (centimes)
        fc.integer({ min: 0, max: 1_000_000 }), // plancher (centimes)
        fc.integer({ min: 0, max: 2_000_000 }), // plafond brut (centimes)
        (rc, plancherC, plafondBrut) => {
          // garantit plancher ≤ plafond
          const plafondC = Math.max(plancherC, plafondBrut);
          const t = new TarifCrechePsu({
            ressourcesMensuelles: Money.depuisCentimes(rc),
            nbEnfantsACharge: 2,
            plancher: Money.depuisCentimes(plancherC),
            plafond: Money.depuisCentimes(plafondC),
          });
          // reconstruit la ressource appliquée attendue (ordre du SUT : plafond d'abord)
          let appliquee = rc;
          if (rc > plafondC) appliquee = plafondC;
          else if (plancherC > rc) appliquee = plancherC;
          // appliquee ∈ [plancher, plafond]
          expect(appliquee).toBeGreaterThanOrEqual(plancherC);
          expect(appliquee).toBeLessThanOrEqual(plafondC);
          expect(t.tarifHoraire.centimes).toBe(tarifHoraireCentimes(appliquee));
        },
      ),
    );
  });
});

describe('MBT property-based — monotonie du tarif PSU (taux fixe)', () => {
  const ressources = Money.depuisEuros(6716.92);

  it('mensualité croissante (large) avec les heures mensualisées', () => {
    const t = new TarifCrechePsu({
      ressourcesMensuelles: ressources,
      nbEnfantsACharge: 2,
    });
    fc.assert(
      fc.property(
        fc.double({ min: 0, max: 5000, noNaN: true, noDefaultInfinity: true }),
        fc.double({ min: 0, max: 5000, noNaN: true, noDefaultInfinity: true }),
        (a, b) => {
          const [lo, hi] = a <= b ? [a, b] : [b, a];
          const coutLo = t.calculerCoutMois({
            heuresAnnuellesContractualisees: lo,
            nbMensualites: 7,
          }).total.centimes;
          const coutHi = t.calculerCoutMois({
            heuresAnnuellesContractualisees: hi,
            nbMensualites: 7,
          }).total.centimes;
          expect(coutHi).toBeGreaterThanOrEqual(coutLo);
        },
      ),
    );
  });

  it('mensualité croissante (large) avec les ressources sous plafond', () => {
    const PLAFOND = Money.depuisEuros(10000);
    const mensualite = (ressourcesCentimes: number): number =>
      new TarifCrechePsu({
        ressourcesMensuelles: Money.depuisCentimes(ressourcesCentimes),
        nbEnfantsACharge: 2,
        plafond: PLAFOND,
      }).calculerCoutMois({
        heuresAnnuellesContractualisees: 885.5,
        nbMensualites: 7,
      }).total.centimes;

    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: 1_000_000 }),
        fc.integer({ min: 0, max: 1_000_000 }),
        (a, b) => {
          const [lo, hi] = a <= b ? [a, b] : [b, a];
          expect(mensualite(hi)).toBeGreaterThanOrEqual(mensualite(lo));
        },
      ),
    );
  });
});

describe('MBT — taux explicite (barème) influe linéairement', () => {
  it('1 enfant (taux 0,000619) ⇒ 4,16 €/h', () => {
    const t = new TarifCrechePsu({
      ressourcesMensuelles: Money.depuisEuros(6716.92),
      nbEnfantsACharge: 1,
      bareme: new BaremeEffortPsu(),
    });
    expect(t.tarifHoraire.centimes).toBe(416);
  });
});
