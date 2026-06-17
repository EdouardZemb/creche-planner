import { describe, expect, it } from 'vitest';
import { Duree } from '@creche-planner/shared-kernel';
import { calculerDeltaPlanning } from './planning-simule.js';
import { MoisIncoherentError } from './planning-simule.js';
import type {
  PlanningMensuel,
  PrestationsMoisCantine,
  PrestationsMoisCreche,
} from './prestations-mois.types.js';

function cantine(mois: string, nbJours: number): PlanningMensuel {
  const presta: PrestationsMoisCantine = {
    mode: 'CANTINE',
    nbJours,
    pai: false,
  };
  return { mois, prestations: [presta] };
}

describe('calculerDeltaPlanning — ABCM (quantités)', () => {
  it('calcule le delta de jours de cantine (ajout)', () => {
    const delta = calculerDeltaPlanning(
      cantine('2026-09', 16),
      cantine('2026-09', 20),
    );
    expect(delta.mois).toBe('2026-09');
    const dCantine = delta.cantine;
    expect(dCantine).toEqual({ nbJours: 4 });
  });

  it('calcule un delta négatif (retrait de jours)', () => {
    const delta = calculerDeltaPlanning(
      cantine('2026-09', 16),
      cantine('2026-09', 12),
    );
    expect(delta.cantine).toEqual({ nbJours: -4 });
  });

  it('additionne matin/soir périscolaire', () => {
    const reel: PlanningMensuel = {
      mois: '2026-09',
      prestations: [{ mode: 'PERISCOLAIRE', nbMatins: 8, nbSoirs: 16 }],
    };
    const simule: PlanningMensuel = {
      mois: '2026-09',
      prestations: [{ mode: 'PERISCOLAIRE', nbMatins: 4, nbSoirs: 20 }],
    };
    expect(calculerDeltaPlanning(reel, simule).periscolaire).toEqual({
      nbMatins: -4,
      nbSoirs: 4,
    });
  });

  it('calcule le delta ALSH (journées, demi-journées, repas)', () => {
    const reel: PlanningMensuel = {
      mois: '2026-10',
      prestations: [
        { mode: 'ALSH', nbJourneesCompletes: 5, nbDemiJournees: 0, nbRepas: 5 },
      ],
    };
    const simule: PlanningMensuel = {
      mois: '2026-10',
      prestations: [
        { mode: 'ALSH', nbJourneesCompletes: 3, nbDemiJournees: 2, nbRepas: 5 },
      ],
    };
    expect(calculerDeltaPlanning(reel, simule).alsh).toEqual({
      nbJourneesCompletes: -2,
      nbDemiJournees: 2,
      nbRepas: 0,
    });
  });

  it('traite un mode absent d un côté comme zéro (ajout depuis rien)', () => {
    const reel: PlanningMensuel = { mois: '2026-09', prestations: [] };
    const delta = calculerDeltaPlanning(reel, cantine('2026-09', 10));
    expect(delta.cantine).toEqual({ nbJours: 10 });
  });

  it('traite un mode présent seulement dans le réel comme retrait', () => {
    const simule: PlanningMensuel = { mois: '2026-09', prestations: [] };
    const delta = calculerDeltaPlanning(cantine('2026-09', 10), simule);
    expect(delta.cantine).toEqual({ nbJours: -10 });
  });

  it('omet un mode inchangé', () => {
    const delta = calculerDeltaPlanning(
      cantine('2026-09', 16),
      cantine('2026-09', 16),
    );
    expect(delta.cantine).toBeUndefined();
  });

  it('traite un périscolaire présent seulement dans le réel comme retrait', () => {
    const reel: PlanningMensuel = {
      mois: '2026-09',
      prestations: [{ mode: 'PERISCOLAIRE', nbMatins: 8, nbSoirs: 16 }],
    };
    const simule: PlanningMensuel = { mois: '2026-09', prestations: [] };
    expect(calculerDeltaPlanning(reel, simule).periscolaire).toEqual({
      nbMatins: -8,
      nbSoirs: -16,
    });
  });

  it('traite un périscolaire présent seulement dans le simulé comme ajout', () => {
    const reel: PlanningMensuel = { mois: '2026-09', prestations: [] };
    const simule: PlanningMensuel = {
      mois: '2026-09',
      prestations: [{ mode: 'PERISCOLAIRE', nbMatins: 8, nbSoirs: 16 }],
    };
    expect(calculerDeltaPlanning(reel, simule).periscolaire).toEqual({
      nbMatins: 8,
      nbSoirs: 16,
    });
  });

  it('omet le périscolaire inchangé', () => {
    const planning: PlanningMensuel = {
      mois: '2026-09',
      prestations: [{ mode: 'PERISCOLAIRE', nbMatins: 8, nbSoirs: 16 }],
    };
    expect(
      calculerDeltaPlanning(planning, planning).periscolaire,
    ).toBeUndefined();
  });

  it('traite un ALSH présent seulement dans le simulé comme ajout', () => {
    const reel: PlanningMensuel = { mois: '2026-10', prestations: [] };
    const simule: PlanningMensuel = {
      mois: '2026-10',
      prestations: [
        { mode: 'ALSH', nbJourneesCompletes: 3, nbDemiJournees: 1, nbRepas: 2 },
      ],
    };
    expect(calculerDeltaPlanning(reel, simule).alsh).toEqual({
      nbJourneesCompletes: 3,
      nbDemiJournees: 1,
      nbRepas: 2,
    });
  });

  it('traite un ALSH présent seulement dans le réel comme retrait', () => {
    const reel: PlanningMensuel = {
      mois: '2026-10',
      prestations: [
        { mode: 'ALSH', nbJourneesCompletes: 3, nbDemiJournees: 1, nbRepas: 2 },
      ],
    };
    const simule: PlanningMensuel = { mois: '2026-10', prestations: [] };
    expect(calculerDeltaPlanning(reel, simule).alsh).toEqual({
      nbJourneesCompletes: -3,
      nbDemiJournees: -1,
      nbRepas: -2,
    });
  });

  it('omet l ALSH inchangé', () => {
    const planning: PlanningMensuel = {
      mois: '2026-10',
      prestations: [
        { mode: 'ALSH', nbJourneesCompletes: 5, nbDemiJournees: 0, nbRepas: 5 },
      ],
    };
    expect(calculerDeltaPlanning(planning, planning).alsh).toBeUndefined();
  });
});

describe('calculerDeltaPlanning — crèche (durées)', () => {
  function creche(mois: string, heuresDeduitesMin: number): PlanningMensuel {
    const presta: PrestationsMoisCreche = {
      mode: 'CRECHE_PSU',
      heuresAnnuellesContractualisees: 885.5,
      nbMensualites: 7,
      heuresMensualisees: 126.5,
      complement: Duree.zero(),
      heuresReservees: Duree.depuisHeuresMinutes(120, 0),
      heuresDeduites: Duree.depuisMinutes(heuresDeduitesMin),
    };
    return { mois, prestations: [presta] };
  }

  it('calcule le delta d heures déduites (en minutes)', () => {
    const delta = calculerDeltaPlanning(
      creche('2026-03', 0),
      creche('2026-03', 480),
    );
    expect(delta.creche).toEqual({
      deltaHeuresReserveesMinutes: 0,
      deltaHeuresDeduitesMinutes: 480,
      deltaComplementMinutes: 0,
    });
  });

  it('omet la crèche si elle est inchangée', () => {
    const delta = calculerDeltaPlanning(
      creche('2026-03', 480),
      creche('2026-03', 480),
    );
    expect(delta.creche).toBeUndefined();
  });

  it('traite une crèche présente seulement dans le simulé comme ajout', () => {
    const reel: PlanningMensuel = { mois: '2026-03', prestations: [] };
    const delta = calculerDeltaPlanning(reel, creche('2026-03', 480));
    expect(delta.creche).toEqual({
      deltaHeuresReserveesMinutes: 120 * 60,
      deltaHeuresDeduitesMinutes: 480,
      deltaComplementMinutes: 0,
    });
  });
});

describe('calculerDeltaPlanning — invariants', () => {
  it('rejette deux plannings de mois différents', () => {
    expect(() =>
      calculerDeltaPlanning(cantine('2026-09', 16), cantine('2026-10', 16)),
    ).toThrow(MoisIncoherentError);
  });
});
