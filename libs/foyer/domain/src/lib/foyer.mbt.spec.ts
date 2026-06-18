/**
 * MBT — SM-01 (state-machine) ; DT-02 (decision table) ; BVA-04/BVA-05 (boundary) ; property-based
 * Critère couverture : 0-switch + 1-switch (machine à états) / combinatoire complète (DT-02) /
 *   BVA 3 points (BVA-04, BVA-05) / property-based (cohérence dérivation + immuabilité) ;
 * Traçabilité doc 17 ; SUT : libs/foyer/domain/src/lib/foyer.ts (Foyer.creer / actualiserRfr / ajouterEnfant)
 */
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { Money, Tranche } from '@creche-planner/shared-kernel';
import { Foyer } from './foyer.js';
import { Enfant } from './enfant.js';
import {
  EnfantsAChargeInvalideError,
  NombreDePartsInvalideError,
} from './foyer-error.js';

// --------------------------------------------------------------------------
// Outillage commun
// --------------------------------------------------------------------------

/** Foyer initial valide servant d'état de départ aux machines à états. */
function foyerInitial(): Foyer {
  return Foyer.creer({
    ressourcesMensuelles: Money.depuisEuros(3000),
    rfr: Money.depuisEuros(30000),
    nbEnfantsACharge: 2,
    nbParts: 3,
    enfants: [],
  });
}

/** Enfant arbitraire valide pour la transition AjouterEnfant. */
function enfantArbitraire(): Enfant {
  return Enfant.creer({
    prenom: 'Test',
    dateNaissance: new Date('2024-01-01'),
  });
}

/** Snapshot immuable de l'état observable d'un Foyer (pour vérifier la non-mutation). */
interface SnapshotFoyer {
  readonly rfrCentimes: number;
  readonly nbEnfants: number;
  readonly trancheNiveau: number;
  readonly nbEnfantsACharge: number;
  readonly nbPartsX1000: number;
  readonly ressourcesCentimes: number;
}

function snapshot(f: Foyer): SnapshotFoyer {
  return {
    rfrCentimes: f.rfr.centimes,
    nbEnfants: f.enfants.length,
    trancheNiveau: f.tranche.niveau,
    nbEnfantsACharge: f.nbEnfantsACharge,
    nbPartsX1000: Math.round(f.nbParts * 1000),
    ressourcesCentimes: f.ressourcesMensuelles.centimes,
  };
}

// ==========================================================================
// SM-01 — Machine à états Foyer (fc.commands + fc.modelRun)
// ==========================================================================

/** Modèle abstrait suivi en parallèle de l'agrégat réel. */
interface ModeleFoyer {
  rfrCentimes: number;
  nbEnfants: number;
}

/** État réel manipulé par les commandes : l'agrégat immuable courant. */
interface RealFoyer {
  current: Foyer;
}

/**
 * Tranche attendue déduite du modèle (réplique de la règle métier ABCM via le
 * SUT shared-kernel, source de vérité de la dérivation).
 */
function trancheAttendue(rfrCentimes: number): Tranche {
  return Tranche.depuisRfr(Money.depuisCentimes(rfrCentimes));
}

/** Commande de transition : actualiserRfr(rfr). */
class ActualiserRfrCommand implements fc.Command<ModeleFoyer, RealFoyer> {
  constructor(private readonly rfrEuros: number) {}

  check(): boolean {
    return true; // transition toujours applicable
  }

  run(model: ModeleFoyer, real: RealFoyer): void {
    const avant = real.current; // référence pour vérifier l'immuabilité
    const snapAvant = snapshot(avant);
    const nouveauRfr = Money.depuisEuros(this.rfrEuros);

    const apres = avant.actualiserRfr(nouveauRfr);

    // L'instance précédente n'a pas muté (immuabilité de l'agrégat).
    expect(snapshot(avant)).toEqual(snapAvant);
    // actualiserRfr renvoie bien une nouvelle instance.
    expect(apres).not.toBe(avant);

    // Mise à jour du modèle.
    model.rfrCentimes = nouveauRfr.centimes;

    // Invariants post-transition.
    expect(apres.tranche.egale(trancheAttendue(model.rfrCentimes))).toBe(true);
    expect(apres.enfants.length).toBe(model.nbEnfants);

    real.current = apres;
  }

  toString(): string {
    return `actualiserRfr(${this.rfrEuros}€)`;
  }
}

/** Commande de transition : ajouterEnfant(e). */
class AjouterEnfantCommand implements fc.Command<ModeleFoyer, RealFoyer> {
  check(): boolean {
    return true;
  }

  run(model: ModeleFoyer, real: RealFoyer): void {
    const avant = real.current;
    const snapAvant = snapshot(avant);
    const nbAvant = avant.enfants.length;

    const apres = avant.ajouterEnfant(enfantArbitraire());

    // Immuabilité : l'ancien foyer conserve son nombre d'enfants.
    expect(snapshot(avant)).toEqual(snapAvant);
    expect(avant.enfants.length).toBe(nbAvant);
    expect(apres).not.toBe(avant);

    model.nbEnfants += 1;

    // Invariants post-transition : un enfant de plus, tranche inchangée.
    expect(apres.enfants.length).toBe(model.nbEnfants);
    expect(apres.tranche.egale(trancheAttendue(model.rfrCentimes))).toBe(true);

    real.current = apres;
  }

  toString(): string {
    return 'ajouterEnfant(e)';
  }
}

describe('SM-01 — Foyer machine à états (MBT fc.commands + fc.modelRun)', () => {
  it('respecte tous les invariants sur des séquences aléatoires (0-switch & 1-switch via le hasard)', () => {
    const commandes = fc.commands(
      [
        fc
          .integer({ min: 0, max: 120000 })
          .map((rfr) => new ActualiserRfrCommand(rfr)),
        fc.constant(new AjouterEnfantCommand()),
      ],
      // Séquences assez longues pour enchaîner toutes les paires de transitions.
      { size: 'large', maxCommands: 30 },
    );

    fc.assert(
      fc.property(commandes, (cmds) => {
        const setup = (): { model: ModeleFoyer; real: RealFoyer } => {
          const f = foyerInitial();
          return {
            model: { rfrCentimes: f.rfr.centimes, nbEnfants: f.enfants.length },
            real: { current: f },
          };
        };
        fc.modelRun(setup, cmds);
      }),
      { numRuns: 200 },
    );
  });
});

// ==========================================================================
// SM-01 — Couverture explicite 0-switch / 1-switch (tabulaire, sans hasard)
// ==========================================================================

type Transition = 'actualiserRfr' | 'ajouterEnfant';

/**
 * Applique une transition au foyer courant en vérifiant immuabilité + invariants,
 * et renvoie le nouveau foyer + le rfr attendu (en centimes).
 */
function appliquer(
  foyer: Foyer,
  transition: Transition,
  rfrCentimesCourant: number,
): { foyer: Foyer; rfrCentimes: number } {
  const snapAvant = snapshot(foyer);
  if (transition === 'actualiserRfr') {
    const nouveauRfr = Money.depuisEuros(45000);
    const apres = foyer.actualiserRfr(nouveauRfr);
    expect(snapshot(foyer)).toEqual(snapAvant); // immuabilité
    expect(apres).not.toBe(foyer);
    expect(apres.tranche.egale(Tranche.depuisRfr(nouveauRfr))).toBe(true);
    return { foyer: apres, rfrCentimes: nouveauRfr.centimes };
  }
  const apres = foyer.ajouterEnfant(enfantArbitraire());
  expect(snapshot(foyer)).toEqual(snapAvant); // immuabilité
  expect(apres).not.toBe(foyer);
  expect(apres.enfants.length).toBe(foyer.enfants.length + 1);
  // La tranche ne dépend que du RFR, inchangé par un ajout d'enfant.
  expect(apres.tranche.egale(Tranche.depuisRfr(apres.rfr))).toBe(true);
  return { foyer: apres, rfrCentimes: rfrCentimesCourant };
}

describe('SM-01 — couverture 0-switch (toutes les transitions une fois)', () => {
  const transitions: Transition[] = ['actualiserRfr', 'ajouterEnfant'];

  it.each(transitions)(
    'transition « %s » applicable depuis l’état initial',
    (t) => {
      const f0 = foyerInitial();
      const { foyer } = appliquer(f0, t, f0.rfr.centimes);
      expect(foyer).toBeInstanceOf(Foyer);
    },
  );
});

describe('SM-01 — couverture 1-switch (toutes les paires de transitions)', () => {
  const paires: readonly (readonly [Transition, Transition])[] = [
    ['actualiserRfr', 'actualiserRfr'],
    ['actualiserRfr', 'ajouterEnfant'],
    ['ajouterEnfant', 'actualiserRfr'],
    ['ajouterEnfant', 'ajouterEnfant'],
  ];

  it.each(paires)(
    'paire %s → %s préserve les invariants et l’immuabilité',
    (t1, t2) => {
      const f0 = foyerInitial();
      const etape1 = appliquer(f0, t1, f0.rfr.centimes);
      const etape2 = appliquer(etape1.foyer, t2, etape1.rfrCentimes);

      // Cohérence finale : tranche dérivée du RFR final.
      expect(
        etape2.foyer.tranche.egale(
          Tranche.depuisRfr(Money.depuisCentimes(etape2.rfrCentimes)),
        ),
      ).toBe(true);
      // L'agrégat initial n'a jamais muté tout au long de la séquence.
      expect(f0.enfants.length).toBe(0);
      expect(f0.rfr.centimes).toBe(Money.depuisEuros(30000).centimes);
    },
  );
});

// ==========================================================================
// DT-02 — Table de décision Foyer.creer (combinatoire complète)
// ==========================================================================

describe('DT-02 — Foyer.creer table de décision (nbEnfantsACharge × nbParts)', () => {
  interface Cas {
    readonly libelle: string;
    readonly nbEnfantsACharge: number;
    readonly nbParts: number;
    readonly attendu:
      | 'ok'
      | 'EnfantsAChargeInvalideError'
      | 'NombreDePartsInvalideError';
  }

  // C1 : nbEnfantsACharge entier ≥ 1 ?  C2 : nbParts fini > 0 ?
  // L'ordre de validation du SUT lève EnfantsAChargeInvalideError en premier
  // lorsque les deux conditions sont fausses.
  const cas: Cas[] = [
    {
      libelle: 'C1=vrai, C2=vrai → OK',
      nbEnfantsACharge: 2,
      nbParts: 3,
      attendu: 'ok',
    },
    {
      libelle: 'C1=vrai, C2=faux → NombreDePartsInvalideError',
      nbEnfantsACharge: 2,
      nbParts: 0,
      attendu: 'NombreDePartsInvalideError',
    },
    {
      libelle: 'C1=faux, C2=vrai → EnfantsAChargeInvalideError',
      nbEnfantsACharge: 0,
      nbParts: 3,
      attendu: 'EnfantsAChargeInvalideError',
    },
    {
      libelle: 'C1=faux, C2=faux → EnfantsAChargeInvalideError (priorité)',
      nbEnfantsACharge: 0,
      nbParts: 0,
      attendu: 'EnfantsAChargeInvalideError',
    },
  ];

  it.each(cas)('$libelle', ({ nbEnfantsACharge, nbParts, attendu }) => {
    const acte = (): Foyer =>
      Foyer.creer({
        ressourcesMensuelles: Money.depuisEuros(3000),
        rfr: Money.depuisEuros(30000),
        nbEnfantsACharge,
        nbParts,
      });

    if (attendu === 'ok') {
      const foyer = acte();
      expect(foyer.nbEnfantsACharge).toBe(nbEnfantsACharge);
      expect(foyer.nbParts).toBe(nbParts);
    } else if (attendu === 'EnfantsAChargeInvalideError') {
      expect(acte).toThrow(EnfantsAChargeInvalideError);
    } else {
      expect(acte).toThrow(NombreDePartsInvalideError);
    }
  });
});

// ==========================================================================
// BVA-04 — nbEnfantsACharge frontière 1 (3 points + non-entier)
// ==========================================================================

describe('BVA-04 — Foyer.creer frontière nbEnfantsACharge = 1', () => {
  const acte = (n: number) => (): Foyer =>
    Foyer.creer({
      ressourcesMensuelles: Money.depuisEuros(3000),
      rfr: Money.depuisEuros(30000),
      nbEnfantsACharge: n,
      nbParts: 2,
    });

  it('0 (juste sous la borne) → rejeté', () => {
    expect(acte(0)).toThrow(EnfantsAChargeInvalideError);
  });

  it('1 (la borne) → accepté', () => {
    expect(acte(1)().nbEnfantsACharge).toBe(1);
  });

  it('2 (juste au-dessus) → accepté', () => {
    expect(acte(2)().nbEnfantsACharge).toBe(2);
  });

  it('1.5 (non-entier dans la zone valide) → rejeté', () => {
    expect(acte(1.5)).toThrow(EnfantsAChargeInvalideError);
  });
});

// ==========================================================================
// BVA-05 — nbParts frontière 0 (3 points + valeurs non finies)
// ==========================================================================

describe('BVA-05 — Foyer.creer frontière nbParts = 0', () => {
  const acte = (p: number) => (): Foyer =>
    Foyer.creer({
      ressourcesMensuelles: Money.depuisEuros(3000),
      rfr: Money.depuisEuros(30000),
      nbEnfantsACharge: 1,
      nbParts: p,
    });

  it('0 (la borne, exclue) → rejeté', () => {
    expect(acte(0)).toThrow(NombreDePartsInvalideError);
  });

  it('ε > 0 (juste au-dessus) → accepté', () => {
    expect(acte(Number.EPSILON)().nbParts).toBe(Number.EPSILON);
  });

  it('0.5 (valeur valide nominale) → accepté', () => {
    expect(acte(0.5)().nbParts).toBe(0.5);
  });

  it('Infinity (non fini) → rejeté', () => {
    expect(acte(Number.POSITIVE_INFINITY)).toThrow(NombreDePartsInvalideError);
  });

  it('NaN (non fini) → rejeté', () => {
    expect(acte(Number.NaN)).toThrow(NombreDePartsInvalideError);
  });
});

// ==========================================================================
// Property-based — cohérence de dérivation & immuabilité
// ==========================================================================

describe('Foyer — propriétés (fast-check)', () => {
  it('pour tout rfr ≥ 0, actualiserRfr(rfr).tranche === Tranche.depuisRfr(rfr)', () => {
    fc.assert(
      fc.property(fc.integer({ min: 0, max: 1_000_000 }), (rfrEuros) => {
        const rfr = Money.depuisEuros(rfrEuros);
        const foyer = foyerInitial().actualiserRfr(rfr);
        expect(foyer.tranche.egale(Tranche.depuisRfr(rfr))).toBe(true);
      }),
    );
  });

  it('actualiserRfr ne mute pas l’instance source', () => {
    fc.assert(
      fc.property(fc.integer({ min: 0, max: 1_000_000 }), (rfrEuros) => {
        const source = foyerInitial();
        const snapAvant = snapshot(source);
        source.actualiserRfr(Money.depuisEuros(rfrEuros));
        expect(snapshot(source)).toEqual(snapAvant);
      }),
    );
  });

  it('ajouterEnfant ne mute pas l’instance source', () => {
    fc.assert(
      fc.property(fc.integer({ min: 1, max: 10 }), (nbAjouts) => {
        const source = foyerInitial();
        const snapAvant = snapshot(source);
        let courant = source;
        for (let i = 0; i < nbAjouts; i += 1) {
          courant = courant.ajouterEnfant(enfantArbitraire());
        }
        // La source n'a jamais bougé ; seul l'agrégat dérivé a grandi.
        expect(snapshot(source)).toEqual(snapAvant);
        expect(courant.enfants.length).toBe(snapAvant.nbEnfants + nbAjouts);
      }),
    );
  });
});
