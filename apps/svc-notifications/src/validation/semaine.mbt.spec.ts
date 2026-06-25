/**
 * MBT — mapping semaine ISO ↔ mois / jours (`semaine.ts`).
 * Critère(s) de couverture : round-trip date → semaine → jours (la date d'origine
 * est l'un des 7 jours) ; cohérence semaine → 7 jours consécutifs lundi→dimanche ;
 * chevauchement de mois borné à {1, 2} (le cas qui justifie le module) ; tous les
 * jours d'une semaine partagent la même semaine ISO. Oracles ponctuels sur des
 * semaines à cheval connues. SUT : semaine.ts.
 */
import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import {
  joursDeLaSemaine,
  moisDeLaSemaine,
  parseSemaineIso,
  semaineIsoDeDate,
} from './semaine.js';

/** Jour calendaire UTC `YYYY-MM-DD` à `n` jours de l'époque (générateur stable). */
function jourDepuisIndex(n: number): string {
  const d = new Date(Date.UTC(2000, 0, 1));
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

/** Arbitraire : une date calendaire sur ~40 ans (2000-01-01 + [0, 14600) jours). */
const dateArb = fc.integer({ min: 0, max: 14_600 }).map(jourDepuisIndex);

describe('MBT semaine ISO ↔ mois / jours', () => {
  // --- Oracles ponctuels : semaines à cheval connues -----------------------
  describe('oracles (semaines à cheval sur deux mois)', () => {
    it('2026-W27 = lundi 29 juin → dimanche 5 juillet (juin + juillet)', () => {
      expect(joursDeLaSemaine('2026-W27')).toEqual([
        '2026-06-29',
        '2026-06-30',
        '2026-07-01',
        '2026-07-02',
        '2026-07-03',
        '2026-07-04',
        '2026-07-05',
      ]);
      expect(moisDeLaSemaine('2026-W27')).toEqual(['2026-06', '2026-07']);
    });

    it('2026-W01 commence le lundi 29 décembre 2025 (année ISO ≠ calendaire)', () => {
      expect(joursDeLaSemaine('2026-W01')[0]).toBe('2025-12-29');
      expect(semaineIsoDeDate('2025-12-29')).toBe('2026-W01');
    });

    it('une semaine entièrement dans un mois ne recouvre qu’un mois', () => {
      expect(moisDeLaSemaine('2026-W03')).toEqual(['2026-01']);
    });
  });

  // --- Propriétés ----------------------------------------------------------
  describe('property-based (fast-check)', () => {
    it('round-trip : la date d’origine est l’un des 7 jours de sa semaine', () => {
      fc.assert(
        fc.property(dateArb, (date) =>
          joursDeLaSemaine(semaineIsoDeDate(date)).includes(date),
        ),
      );
    });

    it('une semaine a 7 jours consécutifs lundi → dimanche (croissants)', () => {
      fc.assert(
        fc.property(dateArb, (date) => {
          const jours = joursDeLaSemaine(semaineIsoDeDate(date));
          if (jours.length !== 7) return false;
          for (let i = 1; i < jours.length; i++) {
            const veille = new Date(`${jours[i - 1]!}T00:00:00.000Z`);
            const jour = new Date(`${jours[i]!}T00:00:00.000Z`);
            if (jour.getTime() - veille.getTime() !== 86_400_000) return false;
          }
          // Le premier jour est un lundi (getUTCDay 1).
          return new Date(`${jours[0]!}T00:00:00.000Z`).getUTCDay() === 1;
        }),
      );
    });

    it('une semaine recouvre 1 ou 2 mois (jamais plus), chacun = mois d’un jour', () => {
      fc.assert(
        fc.property(dateArb, (date) => {
          const semaine = semaineIsoDeDate(date);
          const mois = moisDeLaSemaine(semaine);
          const moisDesJours = new Set(
            joursDeLaSemaine(semaine).map((j) => j.slice(0, 7)),
          );
          return (
            (mois.length === 1 || mois.length === 2) &&
            mois.every((m) => moisDesJours.has(m))
          );
        }),
      );
    });

    it('tous les jours d’une semaine partagent la même semaine ISO', () => {
      fc.assert(
        fc.property(dateArb, (date) => {
          const semaine = semaineIsoDeDate(date);
          return joursDeLaSemaine(semaine).every(
            (j) => semaineIsoDeDate(j) === semaine,
          );
        }),
      );
    });

    it('parseSemaineIso ∘ format est l’identité sur la sortie de semaineIsoDeDate', () => {
      fc.assert(
        fc.property(dateArb, (date) => {
          const semaine = semaineIsoDeDate(date);
          const { annee, semaine: n } = parseSemaineIso(semaine);
          return semaine === `${String(annee)}-W${String(n).padStart(2, '0')}`;
        }),
      );
    });
  });

  // --- Classes d'erreur ----------------------------------------------------
  describe('formes invalides', () => {
    it.each([['2026-W00'], ['2026-W54'], ['2026-27'], ['2026W27'], ['abc']])(
      'parseSemaineIso(%s) lève',
      (valeur) => {
        expect(() => parseSemaineIso(valeur)).toThrow();
      },
    );
  });
});
