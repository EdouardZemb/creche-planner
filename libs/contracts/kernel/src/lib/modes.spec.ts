import { describe, expect, it } from 'vitest';
import { MODES_ABCM, MODES_CONTRAT, estModeAbcm } from './modes.js';

describe('modes (source de vérité unique, SFD 30 §H4)', () => {
  it('MODES_CONTRAT liste les 4 modes de garde, ordre stable (types OpenAPI générés)', () => {
    expect(MODES_CONTRAT).toEqual([
      'CRECHE_PSU',
      'PERISCOLAIRE',
      'CANTINE',
      'ALSH',
    ]);
  });

  it('MODES_ABCM est un sous-ensemble strict de MODES_CONTRAT', () => {
    expect(MODES_ABCM).toEqual(['PERISCOLAIRE', 'CANTINE', 'ALSH']);
    for (const mode of MODES_ABCM) {
      expect(MODES_CONTRAT as readonly string[]).toContain(mode);
    }
  });

  it('estModeAbcm distingue les modes ABCM du barème PSU', () => {
    expect(estModeAbcm('PERISCOLAIRE')).toBe(true);
    expect(estModeAbcm('CANTINE')).toBe(true);
    expect(estModeAbcm('ALSH')).toBe(true);
    expect(estModeAbcm('CRECHE_PSU')).toBe(false);
  });
});
