import { describe, expect, it } from 'vitest';
import {
  aDesModifs,
  calculerDelta,
  extraireSemaine,
} from './validation.diff.js';
import { joursDeLaSemaine } from '@creche-planner/shared-semaine';

const JOURS_W27 = joursDeLaSemaine('2026-W27'); // 2026-06-29 … 2026-07-05

const absence = (date: string) => ({
  date,
  debutHeures: 8,
  debutMinutes: 0,
  finHeures: 18,
  finMinutes: 0,
  preavisJours: 2,
  certificatMaladie: false,
});

// `extraireSemaine` (extraction de la fenêtre) est désormais testé dans
// `@creche-planner/shared-semaine` (`fenetre.spec.ts`) ; il sert ici uniquement à
// construire les snapshots `avant`/`apres` du diff propre à la validation.
describe('calculerDelta / aDesModifs', () => {
  it('snapshot identique ⇒ aucun jour modifié (validation simple)', () => {
    const saisie = { absences: [absence('2026-06-29')] };
    const avant = extraireSemaine([saisie], JOURS_W27);
    const apres = extraireSemaine([saisie], JOURS_W27);
    const delta = calculerDelta(avant, apres);
    expect(aDesModifs(delta)).toBe(false);
    expect(delta.jours).toEqual([]);
  });

  it('un jour ajouté à la relecture ⇒ delta non vide (VALIDEE_AVEC_MODIFS)', () => {
    const avant = extraireSemaine(
      [{ absences: [absence('2026-06-29')] }],
      JOURS_W27,
    );
    const apres = extraireSemaine(
      [{ absences: [absence('2026-06-29'), absence('2026-07-01')] }],
      JOURS_W27,
    );
    const delta = calculerDelta(avant, apres);
    expect(aDesModifs(delta)).toBe(true);
    expect(delta.jours.map((j) => j.date)).toEqual(['2026-07-01']);
    expect(delta.jours[0]?.avant).toBeNull();
    expect(delta.jours[0]?.apres?.absences).toHaveLength(1);
  });

  it('un jour retiré à la relecture ⇒ delta (avant non nul, après nul)', () => {
    const avant = extraireSemaine(
      [{ absences: [absence('2026-06-30')] }],
      JOURS_W27,
    );
    const apres = extraireSemaine([{}], JOURS_W27);
    const delta = calculerDelta(avant, apres);
    expect(delta.jours).toHaveLength(1);
    expect(delta.jours[0]?.date).toBe('2026-06-30');
    expect(delta.jours[0]?.apres).toBeNull();
  });

  it('une entrée modifiée le même jour ⇒ ce jour figure au delta', () => {
    const avant = extraireSemaine(
      [{ absences: [absence('2026-06-29')] }],
      JOURS_W27,
    );
    const apres = extraireSemaine(
      [{ absences: [{ ...absence('2026-06-29'), certificatMaladie: true }] }],
      JOURS_W27,
    );
    const delta = calculerDelta(avant, apres);
    expect(delta.jours.map((j) => j.date)).toEqual(['2026-06-29']);
  });
});
