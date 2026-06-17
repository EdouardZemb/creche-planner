import { describe, expect, it } from 'vitest';
import { PlageHoraire } from './plage-horaire.js';
import { PlageHoraireInvalideError } from '@creche-planner/shared-kernel';

describe('PlageHoraire', () => {
  it('se construit depuis des heures:minutes et expose sa durée', () => {
    // Mia lundi 08:30–17:00 = 8 h 30 = 510 min (doc 02 §7).
    const plage = PlageHoraire.creer(8, 30, 17, 0);
    expect(plage.duree.enMinutes).toBe(510);
    expect(plage.debutMinutes).toBe(510);
    expect(plage.finMinutes).toBe(1020);
  });

  it('rejette une plage dont la fin n est pas après le début (INV-01)', () => {
    expect(() => PlageHoraire.creer(16, 0, 9, 0)).toThrow(
      PlageHoraireInvalideError,
    );
    expect(() => PlageHoraire.creer(9, 0, 9, 0)).toThrow(
      PlageHoraireInvalideError,
    );
  });
});
