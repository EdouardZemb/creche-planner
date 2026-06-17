import { describe, it, expect, afterEach } from 'vitest';
import { couleurDuMode } from './couleurs';

afterEach(() => {
  document.documentElement.style.removeProperty('--mode-creche');
});

describe('couleurDuMode', () => {
  it('utilise le repli quand le token CSS est vide (jsdom)', () => {
    expect(couleurDuMode('PERISCOLAIRE')).toBe('#7c3aed');
    expect(couleurDuMode('ALSH')).toBe('#b45309');
  });

  it('lit la valeur du token CSS quand elle est définie', () => {
    document.documentElement.style.setProperty('--mode-creche', '#123456');
    expect(couleurDuMode('CRECHE_PSU')).toBe('#123456');
  });
});
