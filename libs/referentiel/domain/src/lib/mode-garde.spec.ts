import { describe, expect, it } from 'vitest';
import { estModeAbcm, estModeGarde, parseModeGarde } from './mode-garde.js';
import { ModeGardeInconnuError } from './referentiel-error.js';

describe('ModeGarde', () => {
  it('reconnaît les modes valides', () => {
    expect(estModeGarde('CANTINE')).toBe(true);
    expect(estModeGarde('CRECHE_PSU')).toBe(true);
  });

  it('rejette une valeur inconnue', () => {
    expect(estModeGarde('GARDERIE')).toBe(false);
  });

  it('parse un mode valide', () => {
    expect(parseModeGarde('PERISCOLAIRE')).toBe('PERISCOLAIRE');
  });

  it('lève sur un mode inconnu', () => {
    expect(() => parseModeGarde('GARDERIE')).toThrow(ModeGardeInconnuError);
  });

  it('classe les modes ABCM', () => {
    expect(estModeAbcm('CANTINE')).toBe(true);
    expect(estModeAbcm('PERISCOLAIRE')).toBe(true);
    expect(estModeAbcm('ALSH')).toBe(true);
    expect(estModeAbcm('CRECHE_PSU')).toBe(false);
  });
});
