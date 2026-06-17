import { describe, expect, it } from 'vitest';
import { PlageHoraire } from './plage-horaire.js';
import { SemaineType } from './semaine-type.js';

/** Semaine type crèche de Mia (doc 02 §7) : 25 h 30 / sem. */
function semaineMia(): SemaineType {
  return SemaineType.creer({
    LUNDI: [PlageHoraire.creer(8, 30, 17, 0)], // 8 h 30
    MERCREDI: [PlageHoraire.creer(8, 30, 17, 0)], // 8 h 30
    VENDREDI: [PlageHoraire.creer(8, 30, 17, 0)], // 8 h 30
  });
}

describe('SemaineType', () => {
  it('calcule la durée totale hebdomadaire (Mia = 25 h 30)', () => {
    expect(semaineMia().dureeHebdomadaire.enMinutes).toBe(25 * 60 + 30);
  });

  it('calcule la durée d un jour donné', () => {
    expect(semaineMia().dureeJour('LUNDI').enMinutes).toBe(510);
    expect(semaineMia().dureeJour('MERCREDI').enMinutes).toBe(510);
  });

  it('renvoie une durée nulle pour un jour sans plage', () => {
    expect(semaineMia().dureeJour('MARDI').estZero()).toBe(true);
    expect(semaineMia().dureeJour('SAMEDI').estZero()).toBe(true);
  });

  it('indique si un jour est gardé', () => {
    expect(semaineMia().estGarde('LUNDI')).toBe(true);
    expect(semaineMia().estGarde('MARDI')).toBe(false);
  });

  it('additionne plusieurs plages sur un même jour', () => {
    const semaine = SemaineType.creer({
      LUNDI: [
        PlageHoraire.creer(8, 0, 12, 0), // 4 h
        PlageHoraire.creer(13, 0, 17, 0), // 4 h
      ],
    });
    expect(semaine.dureeJour('LUNDI').enMinutes).toBe(8 * 60);
    expect(semaine.dureeHebdomadaire.enMinutes).toBe(8 * 60);
  });

  it('expose les jours gardés', () => {
    expect(semaineMia().joursGardes).toEqual(['LUNDI', 'MERCREDI', 'VENDREDI']);
  });
});
