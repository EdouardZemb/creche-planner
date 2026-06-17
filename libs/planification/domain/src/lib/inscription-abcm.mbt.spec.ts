/*
 * MBT — DT-05/BVA-10/DT-10/BVA-11 (arbre de classification / tables de décision /
 * BVA / property-based) ; Critère : combinatoire complète ; INV-04 oracle ;
 * héritage invariant ; Traçabilité doc 17 ; SUT : inscription-abcm.ts
 *
 * On teste la GÉNÉRATION DE QUANTITÉS (cantine / péri / ALSH) du domaine
 * Planification, PAS le calcul de coût (Tarification).
 */
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import {
  InscriptionAbcm,
  type ExceptionJour,
  type JourAlsh,
  type SemaineTypeAbcm,
  type TypeAlsh,
} from './inscription-abcm.js';
import type {
  PrestationsMoisAlsh,
  PrestationsMoisCantine,
  PrestationsMoisPeriscolaire,
} from './prestations-mois.types.js';

// --- Repères de dates (septembre 2026, aligné sur le spec existant) ----------
// Jours d'école (semaine type) :
const LUNDI_INSCRIT = '2026-09-07'; // lundi
// Jour NON inscrit en semaine type (mercredi = relève de l'ALSH) :
const MERCREDI_LIBRE = '2026-09-02'; // mercredi
const MOIS = '2026-09';

// =============================================================================
// DT-05 — Arbre de classification « héritage d'exception ABCM »
//   Pour chaque service, exception ∈ {true, false, undefined} ; on vérifie
//   l'inscription EFFECTIVE du jour via la quantité générée (oracle indirect).
//   base = valeur du service dans la semaine type pour ce jour.
// =============================================================================
describe('DT-05 — héritage d exception (true / false / undefined) × service', () => {
  // Oracle : effectif attendu = exc ?? base, puis « compté si === true ».
  type CasHeritage = {
    readonly service: 'cantine' | 'periMatin' | 'periSoir';
    readonly base: boolean | undefined; // valeur en semaine type ce jour-là
    readonly exc: boolean | undefined; // valeur de l'exception
    readonly compteAttendu: boolean; // ce service est-il facturé ce jour ?
  };

  /** base ∈ {true,false,undefined} × exc ∈ {true,false,undefined} = 9 lignes. */
  function casPourService(
    service: 'cantine' | 'periMatin' | 'periSoir',
  ): CasHeritage[] {
    const valeurs: (boolean | undefined)[] = [true, false, undefined];
    const cas: CasHeritage[] = [];
    for (const base of valeurs) {
      for (const exc of valeurs) {
        const effectif = exc ?? base; // sémantique `exc.champ ?? base.champ`
        cas.push({ service, base, exc, compteAttendu: effectif === true });
      }
    }
    return cas;
  }

  const tousLesCas: CasHeritage[] = [
    ...casPourService('cantine'),
    ...casPourService('periMatin'),
    ...casPourService('periSoir'),
  ];

  it.each(tousLesCas)(
    '$service : base=$base, exc=$exc → compté=$compteAttendu',
    ({ service, base, exc, compteAttendu }) => {
      // Semaine type : on n'inscrit le service ce lundi que si base est défini.
      const jourSemaine =
        base === undefined
          ? {}
          : ({ [service]: base } as Record<string, boolean>);
      const exception: ExceptionJour =
        exc === undefined
          ? { date: LUNDI_INSCRIT }
          : { date: LUNDI_INSCRIT, [service]: exc };
      // On isole le lundi 7 en bornant la validité au seul 2026-09-07.
      const inscriptionBornee = InscriptionAbcm.creer({
        semaine: { LUNDI: jourSemaine },
        valideDu: LUNDI_INSCRIT,
        valideAu: LUNDI_INSCRIT,
      });

      const cantine = inscriptionBornee.genererPrestationsCantine({
        mois: MOIS,
        exceptions: [exception],
      }) as PrestationsMoisCantine;
      const peri = inscriptionBornee.genererPrestationsPeriscolaire({
        mois: MOIS,
        exceptions: [exception],
      }) as PrestationsMoisPeriscolaire;

      const compteEffectif =
        service === 'cantine'
          ? cantine.nbJours === 1
          : service === 'periMatin'
            ? peri.nbMatins === 1
            : peri.nbSoirs === 1;
      expect(compteEffectif).toBe(compteAttendu);
    },
  );

  // Quelques combinaisons croisées (plusieurs services surchargés le même jour).
  type CasCroise = {
    readonly nom: string;
    readonly semaine: SemaineTypeAbcm;
    readonly exception: ExceptionJour;
    readonly cantine: number;
    readonly matins: number;
    readonly soirs: number;
  };
  const croises: CasCroise[] = [
    {
      nom: 'tout hérité (exception vide) = semaine type',
      semaine: { LUNDI: { cantine: true, periMatin: true, periSoir: false } },
      exception: { date: LUNDI_INSCRIT },
      cantine: 1,
      matins: 1,
      soirs: 0,
    },
    {
      nom: 'cantine retirée + soir ajouté, matin hérité',
      semaine: { LUNDI: { cantine: true, periMatin: true, periSoir: false } },
      exception: { date: LUNDI_INSCRIT, cantine: false, periSoir: true },
      cantine: 0,
      matins: 1,
      soirs: 1,
    },
    {
      nom: 'tout ajouté sur un jour vide en semaine type',
      semaine: {},
      exception: {
        date: LUNDI_INSCRIT,
        cantine: true,
        periMatin: true,
        periSoir: true,
      },
      cantine: 1,
      matins: 1,
      soirs: 1,
    },
  ];

  it.each(croises)(
    'croisé : $nom',
    ({ semaine, exception, cantine, matins, soirs }) => {
      const inscription = InscriptionAbcm.creer({
        semaine,
        valideDu: LUNDI_INSCRIT,
        valideAu: LUNDI_INSCRIT,
      });
      const c = inscription.genererPrestationsCantine({
        mois: MOIS,
        exceptions: [exception],
      }) as PrestationsMoisCantine;
      const p = inscription.genererPrestationsPeriscolaire({
        mois: MOIS,
        exceptions: [exception],
      }) as PrestationsMoisPeriscolaire;
      expect(c.nbJours).toBe(cantine);
      expect(p.nbMatins).toBe(matins);
      expect(p.nbSoirs).toBe(soirs);
    },
  );
});

// =============================================================================
// BVA-10 — Table « jour facturable ABCM »
//   (inscrit en semaine type T/F) × (exception T/F/undefined)
//                                  × (jour non facturable T/F) → compté ?
//   Oracle : effectif = exc ?? inscrit ; compté = effectif===true && facturable.
// =============================================================================
describe('BVA-10 — table jour facturable (inscrit × exception × non facturable)', () => {
  type CasFacturable = {
    readonly inscrit: boolean; // cantine=true en semaine type ce jour ?
    readonly exc: boolean | undefined; // override cantine de l'exception
    readonly nonFacturable: boolean; // jour férié/fermeture (INV-04)
    readonly compteAttendu: boolean;
  };

  const cas: CasFacturable[] = [];
  for (const inscrit of [true, false]) {
    for (const exc of [true, false, undefined] as (boolean | undefined)[]) {
      for (const nonFacturable of [true, false]) {
        const effectif = exc ?? inscrit;
        cas.push({
          inscrit,
          exc,
          nonFacturable,
          compteAttendu: effectif === true && !nonFacturable,
        });
      }
    }
  }

  it.each(cas)(
    'inscrit=$inscrit, exc=$exc, nonFacturable=$nonFacturable → compté=$compteAttendu',
    ({ inscrit, exc, nonFacturable, compteAttendu }) => {
      const inscription = InscriptionAbcm.creer({
        semaine: inscrit ? { LUNDI: { cantine: true } } : {},
        valideDu: LUNDI_INSCRIT,
        valideAu: LUNDI_INSCRIT,
      });
      const presta = inscription.genererPrestationsCantine({
        mois: MOIS,
        joursNonFacturables: nonFacturable ? [LUNDI_INSCRIT] : [],
        exceptions:
          exc === undefined ? [] : [{ date: LUNDI_INSCRIT, cantine: exc }],
      }) as PrestationsMoisCantine;
      expect(presta.nbJours === 1).toBe(compteAttendu);
    },
  );

  // Cas saillants explicitement nommés (lisibilité de la traçabilité doc 17).
  it('INV-04 : inscrit + non facturable → exclu', () => {
    const presta = InscriptionAbcm.creer({
      semaine: { LUNDI: { cantine: true } },
      valideDu: LUNDI_INSCRIT,
      valideAu: LUNDI_INSCRIT,
    }).genererPrestationsCantine({
      mois: MOIS,
      joursNonFacturables: [LUNDI_INSCRIT],
    }) as PrestationsMoisCantine;
    expect(presta.nbJours).toBe(0);
  });

  it('non inscrit + exception true → compté (ajout ponctuel)', () => {
    const presta = InscriptionAbcm.creer({
      semaine: {},
      valideDu: MERCREDI_LIBRE,
      valideAu: MERCREDI_LIBRE,
    }).genererPrestationsCantine({
      mois: MOIS,
      exceptions: [{ date: MERCREDI_LIBRE, cantine: true }],
    }) as PrestationsMoisCantine;
    expect(presta.nbJours).toBe(1);
  });

  it('inscrit + exception false → exclu (retrait ponctuel)', () => {
    const presta = InscriptionAbcm.creer({
      semaine: { LUNDI: { cantine: true } },
      valideDu: LUNDI_INSCRIT,
      valideAu: LUNDI_INSCRIT,
    }).genererPrestationsCantine({
      mois: MOIS,
      exceptions: [{ date: LUNDI_INSCRIT, cantine: false }],
    }) as PrestationsMoisCantine;
    expect(presta.nbJours).toBe(0);
  });
});

// =============================================================================
// DT-10 — ALSH : type ∈ {COMPLETE, DEMI} × repas ∈ {true, false}
//   → (journées complètes / demi-journées / repas). Combinatoire complète.
// =============================================================================
describe('DT-10 — ALSH type × repas (combinatoire complète)', () => {
  type CasAlsh = {
    readonly type: TypeAlsh;
    readonly repas: boolean;
    readonly completes: number;
    readonly demi: number;
    readonly nbRepas: number;
  };
  const cas: CasAlsh[] = [
    { type: 'COMPLETE', repas: false, completes: 1, demi: 0, nbRepas: 0 },
    { type: 'COMPLETE', repas: true, completes: 1, demi: 0, nbRepas: 1 },
    { type: 'DEMI', repas: false, completes: 0, demi: 1, nbRepas: 0 },
    { type: 'DEMI', repas: true, completes: 0, demi: 1, nbRepas: 1 },
  ];

  it.each(cas)(
    'type=$type, repas=$repas → complètes=$completes demi=$demi repas=$nbRepas',
    ({ type, repas, completes, demi, nbRepas }) => {
      const presta = InscriptionAbcm.creer({
        semaine: {},
      }).genererPrestationsAlsh({
        mois: '2026-10',
        joursAlsh: [{ date: '2026-10-19', type, repas }],
      }) as PrestationsMoisAlsh;
      expect(presta.mode).toBe('ALSH');
      expect(presta.nbJourneesCompletes).toBe(completes);
      expect(presta.nbDemiJournees).toBe(demi);
      expect(presta.nbRepas).toBe(nbRepas);
    },
  );

  it('cas vide : aucun jour ALSH → tout à zéro', () => {
    const presta = InscriptionAbcm.creer({
      semaine: {},
    }).genererPrestationsAlsh({
      mois: '2026-10',
      joursAlsh: [],
    }) as PrestationsMoisAlsh;
    expect(presta.nbJourneesCompletes).toBe(0);
    expect(presta.nbDemiJournees).toBe(0);
    expect(presta.nbRepas).toBe(0);
  });

  it('repas non défini (undefined) équivaut à pas de repas', () => {
    const presta = InscriptionAbcm.creer({
      semaine: {},
    }).genererPrestationsAlsh({
      mois: '2026-10',
      joursAlsh: [{ date: '2026-10-19', type: 'COMPLETE' }],
    }) as PrestationsMoisAlsh;
    expect(presta.nbRepas).toBe(0);
  });
});

// =============================================================================
// BVA-11 — comptage séances péri matin / soir : 0/0, 1/1, n/m, et exclusion
//   des jours non facturables.
// =============================================================================
describe('BVA-11 — comptage séances péri matin / soir (BVA)', () => {
  type CasPeri = {
    readonly nom: string;
    readonly semaine: SemaineTypeAbcm;
    readonly nonFacturables: readonly string[];
    readonly matins: number;
    readonly soirs: number;
  };
  // Semaine type Zoé : matin LUN+VEN, soir LUN+MER+VEN.
  const zoe: SemaineTypeAbcm = {
    LUNDI: { cantine: true, periMatin: true, periSoir: true },
    MERCREDI: { cantine: true, periMatin: false, periSoir: true },
    VENDREDI: { cantine: true, periMatin: true, periSoir: true },
  };

  const cas: CasPeri[] = [
    {
      nom: '0 matin / 0 soir (semaine sans péri)',
      semaine: { LUNDI: { cantine: true } },
      nonFacturables: [],
      matins: 0,
      soirs: 0,
    },
    {
      nom: '1 matin / 1 soir (un seul jour, isolé par validité)',
      semaine: { LUNDI: { periMatin: true, periSoir: true } },
      nonFacturables: [],
      // borne de validité posée dans le test → un seul lundi compté
      matins: 1,
      soirs: 1,
    },
    {
      nom: 'n/m nominal (Zoé : matin 8, soir 12 hors mercredi 30)',
      semaine: zoe,
      nonFacturables: ['2026-09-30'], // ramène à 4 occurrences/jour
      matins: 8,
      soirs: 12,
    },
    {
      nom: 'jour non facturable exclu (lundi matin+soir retirés)',
      semaine: zoe,
      nonFacturables: ['2026-09-30', LUNDI_INSCRIT],
      matins: 7, // 8 − 1
      soirs: 11, // 12 − 1
    },
  ];

  it.each(cas)('$nom', ({ nom, semaine, nonFacturables, matins, soirs }) => {
    const config = nom.startsWith('1 matin')
      ? {
          semaine,
          valideDu: LUNDI_INSCRIT,
          valideAu: LUNDI_INSCRIT,
        }
      : { semaine };
    const presta = InscriptionAbcm.creer(config).genererPrestationsPeriscolaire(
      {
        mois: MOIS,
        joursNonFacturables: nonFacturables,
      },
    ) as PrestationsMoisPeriscolaire;
    expect(presta.mode).toBe('PERISCOLAIRE');
    expect(presta.nbMatins).toBe(matins);
    expect(presta.nbSoirs).toBe(soirs);
  });
});

// =============================================================================
// PROPERTY-BASED (fast-check)
// =============================================================================

/** Générateur d'un service (true/false/undefined) — undefined = champ absent. */
const arbBool3 = fc.constantFrom<boolean | undefined>(true, false, undefined);

/** Générateur d'inscriptions d'un jour (champs éventuellement absents). */
const arbInscriptionsJour = fc.record(
  {
    cantine: arbBool3,
    periMatin: arbBool3,
    periSoir: arbBool3,
  },
  { requiredKeys: [] },
);

/** Générateur d'une semaine type arbitraire sur les jours d'école. */
const arbSemaine: fc.Arbitrary<SemaineTypeAbcm> = fc.record(
  {
    LUNDI: arbInscriptionsJour,
    MARDI: arbInscriptionsJour,
    JEUDI: arbInscriptionsJour,
    VENDREDI: arbInscriptionsJour,
  },
  { requiredKeys: [] },
) as fc.Arbitrary<SemaineTypeAbcm>;

/** Générateur d'une date ISO de septembre 2026 (01..30). */
const arbDateSeptembre = fc
  .integer({ min: 1, max: 30 })
  .map((d) => `2026-09-${String(d).padStart(2, '0')}`);

describe('Property-based — héritage / INV-04 / monotonie', () => {
  // -- Héritage (DT-05) invariant : exception sans aucun champ → inchangé. -----
  it('héritage : exceptions toutes-undefined ne changent rien', () => {
    fc.assert(
      fc.property(
        arbSemaine,
        fc.uniqueArray(arbDateSeptembre, { maxLength: 8 }),
        (semaine, dates) => {
          const inscription = InscriptionAbcm.creer({ semaine });
          const sans = {
            cantine: inscription.genererPrestationsCantine({ mois: MOIS }),
            peri: inscription.genererPrestationsPeriscolaire({ mois: MOIS }),
          };
          // Exceptions « vides » (aucun service surchargé) sur des dates au hasard.
          const exceptions: ExceptionJour[] = dates.map((date) => ({ date }));
          const avec = {
            cantine: inscription.genererPrestationsCantine({
              mois: MOIS,
              exceptions,
            }),
            peri: inscription.genererPrestationsPeriscolaire({
              mois: MOIS,
              exceptions,
            }),
          };
          expect(avec.cantine.nbJours).toBe(sans.cantine.nbJours);
          expect(avec.peri.nbMatins).toBe(sans.peri.nbMatins);
          expect(avec.peri.nbSoirs).toBe(sans.peri.nbSoirs);
        },
      ),
    );
  });

  // -- INV-04 invariant : un jour non facturable n'est JAMAIS compté. ----------
  it('INV-04 : un jour non facturable n est jamais compté (cantine & péri)', () => {
    fc.assert(
      fc.property(
        arbSemaine,
        arbDateSeptembre,
        arbBool3,
        arbBool3,
        arbBool3,
        (semaine, date, c, m, s) => {
          const inscription = InscriptionAbcm.creer({ semaine });
          // On force ce jour comme inscrit ET avec exception « ajout » : peu
          // importe, marqué non facturable il ne doit JAMAIS être compté.
          const exception: ExceptionJour = {
            date,
            ...(c !== undefined ? { cantine: c } : {}),
            ...(m !== undefined ? { periMatin: m } : {}),
            ...(s !== undefined ? { periSoir: s } : {}),
          };
          const ref = {
            cantine: inscription.genererPrestationsCantine({
              mois: MOIS,
              exceptions: [exception],
            }).nbJours,
            matins: inscription.genererPrestationsPeriscolaire({
              mois: MOIS,
              exceptions: [exception],
            }).nbMatins,
            soirs: inscription.genererPrestationsPeriscolaire({
              mois: MOIS,
              exceptions: [exception],
            }).nbSoirs,
          };
          const exclu = {
            cantine: inscription.genererPrestationsCantine({
              mois: MOIS,
              exceptions: [exception],
              joursNonFacturables: [date],
            }).nbJours,
            matins: inscription.genererPrestationsPeriscolaire({
              mois: MOIS,
              exceptions: [exception],
              joursNonFacturables: [date],
            }).nbMatins,
            soirs: inscription.genererPrestationsPeriscolaire({
              mois: MOIS,
              exceptions: [exception],
              joursNonFacturables: [date],
            }).nbSoirs,
          };
          // Exclure le jour ne peut que retirer 0 ou 1 occurrence par service,
          // et le total après exclusion ne dépasse jamais celui sans exclusion.
          expect(exclu.cantine).toBeLessThanOrEqual(ref.cantine);
          expect(exclu.matins).toBeLessThanOrEqual(ref.matins);
          expect(exclu.soirs).toBeLessThanOrEqual(ref.soirs);
          expect(ref.cantine - exclu.cantine).toBeLessThanOrEqual(1);
          expect(ref.matins - exclu.matins).toBeLessThanOrEqual(1);
          expect(ref.soirs - exclu.soirs).toBeLessThanOrEqual(1);
        },
      ),
    );
  });

  // -- INV-04 (ALSH) : un jour ALSH non facturable n'est jamais compté. --------
  it('INV-04 ALSH : un jour ALSH non facturable n est jamais compté', () => {
    const arbJourAlsh: fc.Arbitrary<JourAlsh> = fc.record({
      date: fc
        .integer({ min: 1, max: 31 })
        .map((d) => `2026-10-${String(d).padStart(2, '0')}`),
      type: fc.constantFrom<TypeAlsh>('COMPLETE', 'DEMI'),
      repas: fc.boolean(),
    });
    fc.assert(
      fc.property(
        fc.uniqueArray(arbJourAlsh, {
          maxLength: 10,
          selector: (j) => j.date,
        }),
        (joursAlsh) => {
          const inscription = InscriptionAbcm.creer({ semaine: {} });
          const ref = inscription.genererPrestationsAlsh({
            mois: '2026-10',
            joursAlsh,
          });
          const tous = joursAlsh.map((j) => j.date);
          const exclu = inscription.genererPrestationsAlsh({
            mois: '2026-10',
            joursAlsh,
            joursNonFacturables: tous,
          });
          // Tous les jours non facturables → aucune quantité.
          expect(exclu.nbJourneesCompletes).toBe(0);
          expect(exclu.nbDemiJournees).toBe(0);
          expect(exclu.nbRepas).toBe(0);
          // Et l'exclusion ne peut qu'abaisser (ou laisser égal) les totaux.
          expect(exclu.nbJourneesCompletes).toBeLessThanOrEqual(
            ref.nbJourneesCompletes,
          );
        },
      ),
    );
  });

  // -- Monotonie : exception true n'abaisse pas ; false n'augmente pas. --------
  it('monotonie : exception cantine=true ne diminue pas le nb de jours', () => {
    fc.assert(
      fc.property(arbSemaine, arbDateSeptembre, (semaine, date) => {
        const inscription = InscriptionAbcm.creer({ semaine });
        const base = inscription.genererPrestationsCantine({
          mois: MOIS,
        }).nbJours;
        const avecAjout = inscription.genererPrestationsCantine({
          mois: MOIS,
          exceptions: [{ date, cantine: true }],
        }).nbJours;
        expect(avecAjout).toBeGreaterThanOrEqual(base);
      }),
    );
  });

  it('monotonie : exception cantine=false n augmente pas le nb de jours', () => {
    fc.assert(
      fc.property(arbSemaine, arbDateSeptembre, (semaine, date) => {
        const inscription = InscriptionAbcm.creer({ semaine });
        const base = inscription.genererPrestationsCantine({
          mois: MOIS,
        }).nbJours;
        const avecRetrait = inscription.genererPrestationsCantine({
          mois: MOIS,
          exceptions: [{ date, cantine: false }],
        }).nbJours;
        expect(avecRetrait).toBeLessThanOrEqual(base);
      }),
    );
  });

  it('monotonie péri : exception periMatin/periSoir=true ne diminue pas', () => {
    fc.assert(
      fc.property(arbSemaine, arbDateSeptembre, (semaine, date) => {
        const inscription = InscriptionAbcm.creer({ semaine });
        const base = inscription.genererPrestationsPeriscolaire({ mois: MOIS });
        const avec = inscription.genererPrestationsPeriscolaire({
          mois: MOIS,
          exceptions: [{ date, periMatin: true, periSoir: true }],
        });
        expect(avec.nbMatins).toBeGreaterThanOrEqual(base.nbMatins);
        expect(avec.nbSoirs).toBeGreaterThanOrEqual(base.nbSoirs);
      }),
    );
  });
});
