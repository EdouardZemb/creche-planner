import { describe, it, expect } from 'vitest';
import { formaterDateFr, formaterDateCourtFr } from './dates';

describe('formaterDateFr', () => {
  it('formate une date ISO en jj/mm/aaaa', () => {
    expect(formaterDateFr('2026-06-15')).toBe('15/06/2026');
  });

  it('zéro-pad le jour et le mois', () => {
    expect(formaterDateFr('2026-01-05')).toBe('05/01/2026');
  });
});

describe('formaterDateCourtFr', () => {
  it('formate une date ISO en jj/mm (sans année, affichage mobile)', () => {
    expect(formaterDateCourtFr('2026-06-15')).toBe('15/06');
  });

  it('zéro-pad le jour et le mois', () => {
    expect(formaterDateCourtFr('2026-01-05')).toBe('05/01');
  });
});
