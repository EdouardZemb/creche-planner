import { describe, it, expect } from 'vitest';
import type { PlageHoraire, SemaineTypeCreche } from '../types/bff';
import {
  TYPES_ABSENCE,
  fenetreAbsence,
  plageGardeDuJour,
  saisieAbsenceValide,
  typeAbsenceDepuisFenetre,
  type SaisieHeures,
} from './saisieAbsence';

// Plage de garde de référence : 09:00 → 16:30 (forme produite par
// `plageGardeDuJour`).
const GARDE = { arrivee: '09:00', depart: '16:30' };

/** Saisie complète (les champs non pertinents pour le type sont ignorés). */
function saisie(partiel: Partial<SaisieHeures>): SaisieHeures {
  return { arrivee: '', depart: '', heure: '', ...partiel };
}

/** Construit un `PlageHoraire` à partir de deux libellés `HH:MM`. */
function plage(debut: string, fin: string): PlageHoraire {
  const d = debut.split(':').map(Number);
  const f = fin.split(':').map(Number);
  return {
    debutHeures: d[0] ?? 0,
    debutMinutes: d[1] ?? 0,
    finHeures: f[0] ?? 0,
    finMinutes: f[1] ?? 0,
  };
}

describe('plageGardeDuJour', () => {
  // Semaine type : lundi gardé sur deux créneaux, mercredi non gardé.
  const SEMAINE: SemaineTypeCreche = {
    LUNDI: [plage('09:00', '12:00'), plage('14:00', '16:30')],
    MARDI: [plage('08:30', '17:00')],
  };

  it("étend la garde de l'arrivée du 1er créneau au départ du dernier", () => {
    // 2026-06-01 est un lundi.
    expect(plageGardeDuJour(SEMAINE, '2026-06-01')).toEqual({
      arrivee: '09:00',
      depart: '16:30',
    });
  });

  it('retourne la plage du créneau unique', () => {
    expect(plageGardeDuJour(SEMAINE, '2026-06-02')).toEqual({
      arrivee: '08:30',
      depart: '17:00',
    });
  });

  it('retourne null pour un jour non gardé', () => {
    expect(plageGardeDuJour(SEMAINE, '2026-06-03')).toBeNull();
  });

  it('retourne null sans semaine type', () => {
    expect(plageGardeDuJour(undefined, '2026-06-01')).toBeNull();
  });
});

describe('fenetreAbsence', () => {
  it('« journee » couvre toute la garde', () => {
    expect(fenetreAbsence('journee', saisie({}), GARDE)).toEqual(
      plage('09:00', '16:30'),
    );
  });

  it('« departAvance » retire de l’heure pivot au départ', () => {
    expect(
      fenetreAbsence('departAvance', saisie({ heure: '15:00' }), GARDE),
    ).toEqual(plage('15:00', '16:30'));
  });

  it('« arriveeRetardee » retire de l’arrivée à l’heure pivot', () => {
    expect(
      fenetreAbsence('arriveeRetardee', saisie({ heure: '10:30' }), GARDE),
    ).toEqual(plage('09:00', '10:30'));
  });

  it('« personnalise » reprend la fenêtre libre saisie', () => {
    expect(
      fenetreAbsence(
        'personnalise',
        saisie({ arrivee: '11:00', depart: '13:00' }),
        GARDE,
      ),
    ).toEqual(plage('11:00', '13:00'));
  });

  it('« personnalise » ne dépend pas de la garde (jour sans plage)', () => {
    expect(
      fenetreAbsence(
        'personnalise',
        saisie({ arrivee: '11:00', depart: '13:00' }),
        null,
      ),
    ).toEqual(plage('11:00', '13:00'));
  });

  it('rejette une fenêtre personnalisée incohérente (départ ≤ arrivée)', () => {
    expect(
      fenetreAbsence(
        'personnalise',
        saisie({ arrivee: '13:00', depart: '11:00' }),
        GARDE,
      ),
    ).toBeNull();
  });

  it('rejette un jour non gardé pour les types dérivés de la garde', () => {
    expect(fenetreAbsence('journee', saisie({}), null)).toBeNull();
    expect(
      fenetreAbsence('departAvance', saisie({ heure: '15:00' }), null),
    ).toBeNull();
  });

  it('rejette une heure pivot vide ou hors de la garde (bornes incluses)', () => {
    for (const heure of ['', '09:00', '16:30', '08:00', '18:00']) {
      expect(
        fenetreAbsence('departAvance', saisie({ heure }), GARDE),
      ).toBeNull();
      expect(
        fenetreAbsence('arriveeRetardee', saisie({ heure }), GARDE),
      ).toBeNull();
    }
  });
});

describe('saisieAbsenceValide', () => {
  it('« journee » est toujours valide (la garde est vérifiée par jour)', () => {
    expect(saisieAbsenceValide('journee', saisie({}))).toBe(true);
  });

  it('les types à heure pivot exigent une heure renseignée', () => {
    expect(saisieAbsenceValide('departAvance', saisie({}))).toBe(false);
    expect(
      saisieAbsenceValide('departAvance', saisie({ heure: '15:00' })),
    ).toBe(true);
    expect(saisieAbsenceValide('arriveeRetardee', saisie({}))).toBe(false);
    expect(
      saisieAbsenceValide('arriveeRetardee', saisie({ heure: '10:00' })),
    ).toBe(true);
  });

  it('« personnalise » exige une fenêtre cohérente', () => {
    expect(saisieAbsenceValide('personnalise', saisie({}))).toBe(false);
    expect(
      saisieAbsenceValide(
        'personnalise',
        saisie({ arrivee: '13:00', depart: '11:00' }),
      ),
    ).toBe(false);
    expect(
      saisieAbsenceValide(
        'personnalise',
        saisie({ arrivee: '11:00', depart: '13:00' }),
      ),
    ).toBe(true);
  });
});

describe('typeAbsenceDepuisFenetre', () => {
  it('fenêtre couvrant toute la garde → « journee »', () => {
    expect(typeAbsenceDepuisFenetre(plage('09:00', '16:30'), GARDE)).toEqual({
      typeAbsence: 'journee',
      heure: '',
    });
  });

  it('fenêtre en fin de journée → « departAvance » avec l’heure pivot', () => {
    expect(typeAbsenceDepuisFenetre(plage('15:00', '16:30'), GARDE)).toEqual({
      typeAbsence: 'departAvance',
      heure: '15:00',
    });
  });

  it('fenêtre en début de journée → « arriveeRetardee » avec l’heure pivot', () => {
    expect(typeAbsenceDepuisFenetre(plage('09:00', '10:30'), GARDE)).toEqual({
      typeAbsence: 'arriveeRetardee',
      heure: '10:30',
    });
  });

  it('fenêtre intérieure → « personnalise »', () => {
    expect(typeAbsenceDepuisFenetre(plage('11:00', '13:00'), GARDE)).toEqual({
      typeAbsence: 'personnalise',
      heure: '',
    });
  });

  it('sans garde (classement indéterminé) → « personnalise »', () => {
    expect(typeAbsenceDepuisFenetre(plage('09:00', '16:30'), null)).toEqual({
      typeAbsence: 'personnalise',
      heure: '',
    });
  });

  it('est l’inverse de fenetreAbsence pour chaque type dédié', () => {
    // Aller-retour : la fenêtre dérivée d'une saisie redonne la même saisie.
    for (const { type, heure } of [
      { type: 'departAvance' as const, heure: '15:00' },
      { type: 'arriveeRetardee' as const, heure: '10:30' },
      { type: 'journee' as const, heure: '' },
    ]) {
      const fenetre = fenetreAbsence(type, saisie({ heure }), GARDE);
      expect(fenetre).not.toBeNull();
      if (fenetre === null) continue;
      expect(typeAbsenceDepuisFenetre(fenetre, GARDE)).toEqual({
        typeAbsence: type,
        heure,
      });
    }
  });
});

describe('TYPES_ABSENCE', () => {
  it('expose les 4 types dans l’ordre du sélecteur', () => {
    expect(TYPES_ABSENCE.map((t) => t.valeur)).toEqual([
      'journee',
      'departAvance',
      'arriveeRetardee',
      'personnalise',
    ]);
  });
});
