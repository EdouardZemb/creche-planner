import { describe, it, expect } from 'vitest';
import { LIBELLES_MODE } from './libelles';

describe('LIBELLES_MODE', () => {
  it('expose un libellé accentué pour chaque mode', () => {
    expect(LIBELLES_MODE.CRECHE_PSU).toBe('Crèche PSU');
    expect(LIBELLES_MODE.CANTINE).toBe('Cantine');
    expect(LIBELLES_MODE.PERISCOLAIRE).toBe('Périscolaire');
    expect(LIBELLES_MODE.ALSH).toBe('ALSH');
  });

  it("n'affiche jamais le mode brut", () => {
    expect(LIBELLES_MODE.CRECHE_PSU).not.toBe('CRECHE_PSU');
  });
});
