import { describe, expect, it } from 'vitest';
import {
  aDesModifs,
  calculerDelta,
  extraireSemaine,
} from './validation.diff.js';
import { joursDeLaSemaine } from './semaine.js';

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

describe('extraireSemaine', () => {
  it('ne retient que les entrées datées dans la fenêtre de la semaine', () => {
    const saisie = {
      complementMinutes: 30, // scalaire mensuel : hors périmètre jour
      absences: [
        absence('2026-06-29'), // dans la semaine
        absence('2026-06-15'), // hors semaine
      ],
    };
    const snap = extraireSemaine([saisie], JOURS_W27);
    expect(Object.keys(snap)).toEqual(['2026-06-29']);
    expect(snap['2026-06-29']?.absences).toHaveLength(1);
  });

  it('fusionne les saisies des deux mois d’une semaine à cheval', () => {
    const juin = { absences: [absence('2026-06-30')] };
    const juillet = { joursSupplementaires: [{ date: '2026-07-02' }] };
    const snap = extraireSemaine([juin, juillet], JOURS_W27);
    expect(Object.keys(snap).sort()).toEqual(['2026-06-30', '2026-07-02']);
    expect(snap['2026-07-02']?.joursSupplementaires).toHaveLength(1);
  });

  it('ignore les entrées sans date et les saisies nulles/absentes', () => {
    const saisie = { absences: [{ preavisJours: 0 }] }; // pas de `date`
    expect(extraireSemaine([saisie, null, undefined], JOURS_W27)).toEqual({});
  });
});

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
