// MBT — DT-09 (Decision Table, combinatoire complète) ;
// Critère : combinatoire complète pai {true,false} × tranche {T1,T2,T3} + BVA sur nbJours ;
// Traçabilité doc 17 ; SUT : abcm/tarif-cantine-abcm.ts (via grille-abcm.ts)
import { describe, expect, it } from 'vitest';
import { Tranche } from '@creche-planner/shared-kernel';
import { GrilleAbcm } from './grille-abcm.js';
import { TarifCantineAbcm } from './tarif-cantine-abcm.js';
import {
  GrilleIndisponibleError,
  QuantiteInvalideError,
} from '../core/tarification-error.js';

/**
 * Modèle DT-09 — cantine ABCM (tarif-cantine-abcm.ts).
 * Coût = nbJours × tarif unitaire de la tranche, où :
 *   pai = false ⇒ cantineTotal
 *   pai = true  ⇒ cantinePartGarde (définie pour T3 seulement)
 *
 * Combinatoire pai × tranche. La part garde n'existant qu'en T3, les cas
 * pai=true sur T1/T2 lèvent GrilleIndisponibleError (modélisé explicitement).
 */

// tarif unitaire (centimes) par (pai, tranche) ; null = combinaison interdite (lève)
const TARIF_UNITAIRE: Record<
  'T1' | 'T2' | 'T3',
  { normal: number; pai: number | null }
> = {
  T1: { normal: 1050, pai: null },
  T2: { normal: 1165, pai: null },
  T3: { normal: 1268, pai: 801 },
};

const TRANCHES: ReadonlyArray<['T1' | 'T2' | 'T3', Tranche]> = [
  ['T1', Tranche.T1],
  ['T2', Tranche.T2],
  ['T3', Tranche.T3],
];

const NB_JOURS = 20;

describe('MBT DT-09 — cantine pai × tranche (combinatoire complète)', () => {
  // pai = false : valide pour toutes les tranches
  it.each(TRANCHES)(
    'pai=false, %s ⇒ nbJours × cantineTotal',
    (clef, tranche) => {
      const tarif = new TarifCantineAbcm(GrilleAbcm.pour(tranche));
      const cout = tarif.calculerCoutMois({ nbJours: NB_JOURS, pai: false });
      expect(cout.total.centimes).toBe(TARIF_UNITAIRE[clef].normal * NB_JOURS);
    },
  );

  // pai = true : valide uniquement en T3
  it('pai=true, T3 ⇒ nbJours × cantinePartGarde', () => {
    const tarif = new TarifCantineAbcm(GrilleAbcm.pour(Tranche.T3));
    const cout = tarif.calculerCoutMois({ nbJours: NB_JOURS, pai: true });
    expect(cout.total.centimes).toBe(
      (TARIF_UNITAIRE.T3.pai as number) * NB_JOURS,
    );
  });

  const paiInterdit: ReadonlyArray<['T1' | 'T2', Tranche]> = [
    ['T1', Tranche.T1],
    ['T2', Tranche.T2],
  ];
  it.each(paiInterdit)(
    'pai=true, %s ⇒ GrilleIndisponibleError (part garde non définie)',
    (_clef, tranche) => {
      const tarif = new TarifCantineAbcm(GrilleAbcm.pour(tranche));
      expect(() =>
        tarif.calculerCoutMois({ nbJours: NB_JOURS, pai: true }),
      ).toThrow(GrilleIndisponibleError);
    },
  );

  it('pai par défaut (absent) ⇒ traité comme pai=false', () => {
    const tarif = new TarifCantineAbcm(GrilleAbcm.pour(Tranche.T3));
    const cout = tarif.calculerCoutMois({ nbJours: NB_JOURS });
    expect(cout.total.centimes).toBe(TARIF_UNITAIRE.T3.normal * NB_JOURS);
  });
});

describe('MBT DT-09 — libellés distinctifs PAI vs normal', () => {
  it('normal ⇒ libellé « Cantine »', () => {
    const tarif = new TarifCantineAbcm(GrilleAbcm.pour(Tranche.T3));
    expect(
      tarif.calculerCoutMois({ nbJours: 1, pai: false }).lignes[0]?.libelle,
    ).toBe('Cantine');
  });

  it('PAI ⇒ libellé « Cantine (PAI — part garde) »', () => {
    const tarif = new TarifCantineAbcm(GrilleAbcm.pour(Tranche.T3));
    expect(
      tarif.calculerCoutMois({ nbJours: 1, pai: true }).lignes[0]?.libelle,
    ).toBe('Cantine (PAI — part garde)');
  });
});

describe('MBT DT-09 — BVA sur nbJours', () => {
  const tarif = () => new TarifCantineAbcm(GrilleAbcm.pour(Tranche.T3));

  it('nbJours = 0 (borne basse) ⇒ coût nul (ligne à 0)', () => {
    expect(
      tarif().calculerCoutMois({ nbJours: 0, pai: false }).total.centimes,
    ).toBe(0);
  });

  it('nbJours = 1 (borne basse + 1) ⇒ 1 tarif unitaire', () => {
    expect(
      tarif().calculerCoutMois({ nbJours: 1, pai: false }).total.centimes,
    ).toBe(1268);
  });

  const invalides: ReadonlyArray<[string, number]> = [
    ['négatif (borne basse − 1)', -1],
    ['non entier', 2.5],
  ];
  it.each(invalides)('nbJours %s ⇒ QuantiteInvalideError', (_l, nbJours) => {
    expect(() => tarif().calculerCoutMois({ nbJours, pai: false })).toThrow(
      QuantiteInvalideError,
    );
  });
});
