import { describe, expect, it } from 'vitest';
import { Tranche } from '@creche-planner/shared-kernel';
import { trancheDepuisNiveau } from './tranche-ref.js';
import { TrancheInconnueError } from './referentiel-error.js';

describe('trancheDepuisNiveau', () => {
  it('mappe 1/2/3 vers les tranches canoniques', () => {
    expect(trancheDepuisNiveau(1)).toBe(Tranche.T1);
    expect(trancheDepuisNiveau(2)).toBe(Tranche.T2);
    expect(trancheDepuisNiveau(3)).toBe(Tranche.T3);
  });

  it('lève sur un niveau hors {1,2,3}', () => {
    expect(() => trancheDepuisNiveau(0)).toThrow(TrancheInconnueError);
    expect(() => trancheDepuisNiveau(4)).toThrow(TrancheInconnueError);
  });
});
