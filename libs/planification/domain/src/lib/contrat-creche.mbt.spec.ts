/**
 * MBT — SM-03/DT-04/BVA-08/BVA-09 (machine à états / table de décision / BVA /
 * property-based) ; Critère : états+transitions BVA bornes ; table de vérité
 * complète ; BVA 3 points ; invariants oracles ; Traçabilité doc 17 ;
 * SUT : contrat-creche.ts
 *
 * Modèles couverts :
 *  - SM-03  : machine à états « couverture du mois » (AVANT / DANS / APRÈS la
 *             période de validité) ; transition pilotée par le mois demandé vs
 *             [valideDu, valideAu] ; BVA 3 points sur les bornes mensuelles.
 *  - DT-04  : table de décision « éligibilité déduction d'absence »
 *             (preavisJours >= 2 || certificatMaladie), table de vérité complète
 *             preavis ∈ {0,1,2,3,5} × certificat ∈ {true,false} + BVA seuil préavis.
 *  - BVA-08 : INV-05 « heures déduites ≤ heures réservées », 3 points autour de
 *             l'égalité.
 *  - BVA-09 : agrégation des jours supplémentaires au complément du mois.
 *  - Property-based (fast-check) : invariant INV-05, monotonie des heures nettes,
 *             nullité hors période.
 */
import { describe, expect, it } from 'vitest';
import * as fc from 'fast-check';
import { Duree } from '@creche-planner/shared-kernel';
import { ContratCreche } from './contrat-creche.js';
import { PlageHoraire } from './plage-horaire.js';
import { SemaineType } from './semaine-type.js';
import { DeductionExcessiveError } from './planification-error.js';
import type { PrestationsMoisCreche } from './prestations-mois.types.js';

// ---------------------------------------------------------------------------
// Fixtures : contrat crèche PSU de référence (doc 02 §7). Période de validité
// [2026-01-01, 2026-07-31]. Bornes mensuelles :
//   - mois de valideDu = 2026-01 ; mois (valideDu)-1 = 2025-12
//   - mois de valideAu = 2026-07 ; mois (valideAu)+1 = 2026-08
// ---------------------------------------------------------------------------
const VALIDE_DU = '2026-01-01';
const VALIDE_AU = '2026-07-31';

/** Semaine type crèche de Mia (doc 02 §7) : LUN/MER/VEN ≈ 25 h 30 / sem. */
function semaineMia(): SemaineType {
  return SemaineType.creer({
    LUNDI: [PlageHoraire.creer(8, 30, 17, 0)],
    MERCREDI: [PlageHoraire.creer(8, 30, 17, 0)],
    VENDREDI: [PlageHoraire.creer(8, 30, 17, 0)],
  });
}

function contratMia(): ContratCreche {
  return ContratCreche.creer({
    valideDu: VALIDE_DU,
    valideAu: VALIDE_AU,
    heuresAnnuellesContractualisees: 885.5,
    nbMensualites: 7,
    semaineType: semaineMia(),
  });
}

function presta(
  contrat: ContratCreche,
  mois: string,
  options: Record<string, unknown> = {},
): PrestationsMoisCreche {
  return contrat.genererPrestationsMois({
    mois,
    ...options,
  });
}

/** Oracle : prestation entièrement nulle (mois hors période, SM-03 AVANT/APRÈS). */
function attendZeroPrestation(p: PrestationsMoisCreche): void {
  expect(p.mode).toBe('CRECHE_PSU');
  expect(p.heuresAnnuellesContractualisees).toBe(0);
  expect(p.heuresMensualisees).toBe(0);
  expect(p.heuresReservees.estZero()).toBe(true);
  expect(p.heuresDeduites.estZero()).toBe(true);
  expect(p.complement.estZero()).toBe(true);
}

// ===========================================================================
// SM-03 — Machine à états « couverture du mois »
// États : AVANT période / DANS période / APRÈS période.
// Transition : pilotée par le mois demandé vs [valideDu, valideAu].
// BVA 3 points sur les bornes mensuelles (valideDu et valideAu).
// ===========================================================================
describe('SM-03 — machine à états « couverture du mois » (BVA bornes)', () => {
  interface CasEtat {
    readonly libelle: string;
    readonly mois: string;
    readonly etat: 'AVANT' | 'DANS' | 'APRES';
    readonly couvert: boolean;
  }

  // Transitions/états couverts, avec BVA 3 points sur chaque borne :
  //  - borne basse valideDu (2026-01) : (mois-1)=2025-12 →AVANT ; 2026-01 →DANS
  //  - borne haute valideAu (2026-07) : 2026-07 →DANS ; (mois+1)=2026-08 →APRES
  const casEtats: readonly CasEtat[] = [
    // --- État AVANT (mois entièrement antérieur à valideDu) ---
    {
      libelle: 'AVANT — deux mois avant le début (2025-11)',
      mois: '2025-11',
      etat: 'AVANT',
      couvert: false,
    },
    {
      libelle: 'AVANT — borne basse −1 : mois (valideDu)−1 (2025-12)',
      mois: '2025-12',
      etat: 'AVANT',
      couvert: false,
    },
    // --- État DANS (au moins un jour du mois dans la période) ---
    {
      libelle: 'DANS — borne basse : mois de valideDu (2026-01)',
      mois: '2026-01',
      etat: 'DANS',
      couvert: true,
    },
    {
      libelle: 'DANS — milieu de période (2026-03)',
      mois: '2026-03',
      etat: 'DANS',
      couvert: true,
    },
    {
      libelle: 'DANS — borne haute : mois de valideAu (2026-07)',
      mois: '2026-07',
      etat: 'DANS',
      couvert: true,
    },
    // --- État APRÈS (mois entièrement postérieur à valideAu) ---
    {
      libelle: 'APRES — borne haute +1 : mois (valideAu)+1 (2026-08)',
      mois: '2026-08',
      etat: 'APRES',
      couvert: false,
    },
    {
      libelle: 'APRES — deux mois après la fin (2026-09)',
      mois: '2026-09',
      etat: 'APRES',
      couvert: false,
    },
  ];

  it.each(casEtats)(
    'couvreMois reflète l état : $libelle → couvert=$couvert',
    ({ mois, couvert }) => {
      expect(contratMia().couvreMois(mois)).toBe(couvert);
    },
  );

  it.each(casEtats.filter((c) => c.etat === 'DANS'))(
    'transition DANS → prestations calculées (non nulles) : $libelle',
    ({ mois }) => {
      const p = presta(contratMia(), mois);
      expect(p.heuresAnnuellesContractualisees).toBe(885.5);
      expect(p.heuresMensualisees).toBe(126.5);
      expect(p.heuresReservees.enMinutes).toBeGreaterThan(0);
    },
  );

  it.each(casEtats.filter((c) => c.etat !== 'DANS'))(
    'transition hors période (AVANT/APRES) → zéro prestation : $libelle',
    ({ mois }) => {
      attendZeroPrestation(presta(contratMia(), mois));
    },
  );

  it('BVA bornes : 2025-12→zéro, 2026-01→calcul, 2026-07→calcul, 2026-08→zéro', () => {
    const c = contratMia();
    attendZeroPrestation(presta(c, '2025-12')); // (valideDu)-1
    expect(presta(c, '2026-01').heuresReservees.enMinutes).toBeGreaterThan(0); // valideDu
    expect(presta(c, '2026-07').heuresReservees.enMinutes).toBeGreaterThan(0); // valideAu
    attendZeroPrestation(presta(c, '2026-08')); // (valideAu)+1
  });
});

// ===========================================================================
// DT-04 — Table de décision « éligibilité déduction d'absence »
// Règle (contrat-creche.ts ~L81-83) : preavisJours >= 2 || certificatMaladie.
// Table de vérité COMPLÈTE : preavis ∈ {0,1,2,3,5} × certificat ∈ {true,false}.
// Effet réel vérifié sur heuresDeduites via genererPrestationsMois.
// ===========================================================================
describe('DT-04 — table de décision « éligibilité déduction » (table de vérité complète)', () => {
  interface CasDecision {
    readonly preavis: number;
    readonly certificat: boolean;
    readonly deductible: boolean;
    readonly note?: string;
  }

  // Une absence courte (4 h) — bien < heures réservées d'un mois couvert.
  const DUREE_ABS = Duree.depuisHeuresMinutes(4, 0);
  const MOIS_DANS = '2026-03';

  // Table de vérité complète : 5 préavis × 2 certificat = 10 cellules, dont les
  // cellules « implicites » explicitement relevées (0,false)→NON, (5,true)→OUI.
  const table: readonly CasDecision[] = [
    {
      preavis: 0,
      certificat: false,
      deductible: false,
      note: 'cellule implicite (0,false)→NON',
    },
    { preavis: 0, certificat: true, deductible: true },
    { preavis: 1, certificat: false, deductible: false, note: 'BVA seuil −1' },
    { preavis: 1, certificat: true, deductible: true },
    { preavis: 2, certificat: false, deductible: true, note: 'BVA seuil = 2' },
    { preavis: 2, certificat: true, deductible: true },
    { preavis: 3, certificat: false, deductible: true },
    { preavis: 3, certificat: true, deductible: true },
    { preavis: 5, certificat: false, deductible: true },
    {
      preavis: 5,
      certificat: true,
      deductible: true,
      note: 'cellule implicite (5,true)→OUI',
    },
  ];

  it.each(table)(
    'preavis=$preavis, certificat=$certificat → déductible=$deductible',
    ({ preavis, certificat, deductible }) => {
      const p = presta(contratMia(), MOIS_DANS, {
        absences: [
          {
            duree: DUREE_ABS,
            preavisJours: preavis,
            certificatMaladie: certificat,
          },
        ],
      });
      if (deductible) {
        expect(p.heuresDeduites.enMinutes).toBe(DUREE_ABS.enMinutes);
      } else {
        expect(p.heuresDeduites.estZero()).toBe(true);
      }
    },
  );

  it('BVA seuil préavis 3 points : 1→NON, 2→OUI (sans certificat)', () => {
    const c = contratMia();
    const non = presta(c, MOIS_DANS, {
      absences: [
        { duree: DUREE_ABS, preavisJours: 1, certificatMaladie: false },
      ],
    });
    const oui = presta(c, MOIS_DANS, {
      absences: [
        { duree: DUREE_ABS, preavisJours: 2, certificatMaladie: false },
      ],
    });
    expect(non.heuresDeduites.estZero()).toBe(true);
    expect(oui.heuresDeduites.enMinutes).toBe(DUREE_ABS.enMinutes);
  });
});

// ===========================================================================
// BVA-08 — INV-05 « heures déduites ≤ heures réservées »
// (contrat-creche.ts ~L192-196). 3 points autour de l'égalité, exprimés en
// fraction des heures réservées réelles du mois (oracle dynamique).
// ===========================================================================
describe('BVA-08 — INV-05 déduction ≤ réservées (3 points autour de l égalité)', () => {
  const MOIS_DANS = '2026-03';

  /** Heures réservées (minutes) réellement calculées pour le mois couvert. */
  function reserveesMinutes(): number {
    return presta(contratMia(), MOIS_DANS).heuresReservees.enMinutes;
  }

  function absDeductible(minutes: number) {
    return {
      absences: [
        {
          duree: Duree.depuisMinutes(minutes),
          preavisJours: 3,
          certificatMaladie: false,
        },
      ],
    };
  }

  it('point bas : déduites < réservées (réservées − 50 min) → OK', () => {
    const reservees = reserveesMinutes();
    const p = presta(contratMia(), MOIS_DANS, absDeductible(reservees - 50));
    expect(p.heuresDeduites.enMinutes).toBe(reservees - 50);
    expect(p.heuresDeduites.enMinutes).toBeLessThanOrEqual(
      p.heuresReservees.enMinutes,
    );
  });

  it('point égalité : déduites = réservées → OK (pas d erreur, INV-05 inclusif)', () => {
    const reservees = reserveesMinutes();
    const p = presta(contratMia(), MOIS_DANS, absDeductible(reservees));
    expect(p.heuresDeduites.enMinutes).toBe(reservees);
    expect(p.heuresDeduites.enMinutes).toBe(p.heuresReservees.enMinutes);
  });

  it('point haut : déduites = réservées + 1 min → DeductionExcessiveError', () => {
    const reservees = reserveesMinutes();
    expect(() =>
      presta(contratMia(), MOIS_DANS, absDeductible(reservees + 1)),
    ).toThrow(DeductionExcessiveError);
  });
});

// ===========================================================================
// BVA-09 — Agrégation des jours supplémentaires au complément
// Filtrage : un jour sup compte s'il est dans le mois demandé ET dans la
// période de validité ; sinon il est ignoré. Vérifie le complément résultant.
// ===========================================================================
describe('BVA-09 — agrégation jours supplémentaires au complément', () => {
  const MOIS_DANS = '2026-03';
  const SEPT_HEURES = Duree.depuisHeuresMinutes(7, 0); // 420 min

  it('complément seul (sans jour sup) : reporté tel quel', () => {
    const p = presta(contratMia(), MOIS_DANS, {
      complement: Duree.depuisMinutes(30),
    });
    expect(p.complement.enMinutes).toBe(30);
  });

  it('jour sup cohérent (dans le mois et la période) : cumulé au complément', () => {
    const p = presta(contratMia(), MOIS_DANS, {
      complement: Duree.depuisMinutes(30),
      joursSupplementaires: [{ date: '2026-03-10', duree: SEPT_HEURES }],
    });
    expect(p.complement.enMinutes).toBe(30 + 420);
  });

  it('jour sup hors du mois demandé : filtré (complément inchangé)', () => {
    const p = presta(contratMia(), MOIS_DANS, {
      complement: Duree.depuisMinutes(30),
      // date d'avril alors qu'on génère mars
      joursSupplementaires: [{ date: '2026-04-10', duree: SEPT_HEURES }],
    });
    expect(p.complement.enMinutes).toBe(30);
  });

  it('jour sup hors période de validité : filtré (mois couvert, jour au-delà de valideAu)', () => {
    // On génère juillet (couvert) mais avec un jour sup au 32e jour fictif ?
    // valideAu = 2026-07-31. Un jour sup daté en juillet est dans la période.
    // Pour exercer le filtre période sur un mois COUVERT, on prend le mois de
    // valideAu et un jour sup dont la date sort de la période n'est pas possible
    // à l'intérieur du même mois (juillet entier ≤ valideAu). On exerce donc le
    // filtre période sur le mois de fin partielle suivant : génération de
    // juillet, jour sup en juillet RESTE valide. À la place, on vérifie le
    // filtre période via un contrat qui finit en milieu de mois.
    const contratFinMois = ContratCreche.creer({
      valideDu: '2026-01-01',
      valideAu: '2026-07-15',
      heuresAnnuellesContractualisees: 885.5,
      nbMensualites: 7,
      semaineType: semaineMia(),
    });
    const p = contratFinMois.genererPrestationsMois({
      mois: '2026-07',
      complement: Duree.depuisMinutes(30),
      joursSupplementaires: [
        { date: '2026-07-10', duree: SEPT_HEURES }, // ≤ valideAu → compté
        { date: '2026-07-20', duree: SEPT_HEURES }, // > valideAu → filtré
      ],
    });
    expect(p.complement.enMinutes).toBe(30 + 420);
  });
});

// ===========================================================================
// Property-based (fast-check)
// ===========================================================================
describe('Property-based — invariants oracles (fast-check)', () => {
  const MOIS_DANS = '2026-03';

  /** Heures réservées (minutes) du mois couvert de référence. */
  const RESERVEES_MIN = presta(contratMia(), MOIS_DANS).heuresReservees
    .enMinutes;

  /** Génère une absence déductible de durée bornée (minutes). */
  function arbAbsenceDeductible(maxMinutes: number) {
    return fc.record({
      duree: fc
        .integer({ min: 0, max: maxMinutes })
        .map((m) => Duree.depuisMinutes(m)),
      preavisJours: fc.integer({ min: 2, max: 30 }),
      certificatMaladie: fc.boolean(),
    });
  }

  it('INV-05 invariant : somme des durées ≤ réservées ⇒ jamais d erreur et heuresDeduites ≤ heuresReservees', () => {
    fc.assert(
      fc.property(
        // Liste d'absences déductibles dont la somme des durées est bornée par
        // les heures réservées du mois (chaque durée ≤ réservées/4, ≤ 4 items).
        fc.array(arbAbsenceDeductible(Math.floor(RESERVEES_MIN / 4)), {
          minLength: 0,
          maxLength: 4,
        }),
        (absences) => {
          const p = presta(contratMia(), MOIS_DANS, { absences });
          const somme = absences.reduce((t, a) => t + a.duree.enMinutes, 0);
          expect(p.heuresDeduites.enMinutes).toBe(somme);
          expect(p.heuresDeduites.enMinutes).toBeLessThanOrEqual(
            p.heuresReservees.enMinutes,
          );
        },
      ),
    );
  });

  it('Monotonie : ajouter une absence déductible (en restant ≤ réservées) ne fait pas augmenter les heures nettes (réservées − déduites)', () => {
    fc.assert(
      fc.property(
        arbAbsenceDeductible(Math.floor(RESERVEES_MIN / 2)),
        arbAbsenceDeductible(Math.floor(RESERVEES_MIN / 2)),
        (a, b) => {
          const base = presta(contratMia(), MOIS_DANS, { absences: [a] });
          const augmente = presta(contratMia(), MOIS_DANS, {
            absences: [a, b],
          });
          const netteBase =
            base.heuresReservees.enMinutes - base.heuresDeduites.enMinutes;
          const netteAugmente =
            augmente.heuresReservees.enMinutes -
            augmente.heuresDeduites.enMinutes;
          // Les heures réservées sont invariantes ; ajouter une déduction ne peut
          // que faire décroître (ou égaler) les heures nettes.
          expect(netteAugmente).toBeLessThanOrEqual(netteBase);
        },
      ),
    );
  });

  it('Hors période : pour tout mois hors [valideDu, valideAu], prestation = zéro', () => {
    fc.assert(
      fc.property(
        fc.oneof(
          // Mois clairement AVANT 2026-01.
          fc.record({
            annee: fc.integer({ min: 2020, max: 2025 }),
            mois: fc.integer({ min: 1, max: 12 }),
          }),
          // Mois clairement APRÈS 2026-07.
          fc.oneof(
            fc.record({
              annee: fc.constant(2026),
              mois: fc.integer({ min: 8, max: 12 }),
            }),
            fc.record({
              annee: fc.integer({ min: 2027, max: 2035 }),
              mois: fc.integer({ min: 1, max: 12 }),
            }),
          ),
        ),
        ({ annee, mois }) => {
          const moisIso = `${annee}-${mois.toString().padStart(2, '0')}`;
          attendZeroPrestation(presta(contratMia(), moisIso));
        },
      ),
    );
  });
});
