import { describe, it, expect } from 'vitest';
import { GLOSSAIRE, estSigleConnu, libelleSigle } from './glossaire';

describe('glossaire', () => {
  it('expose les sigles métier requis avec leur libellé long', () => {
    expect(GLOSSAIRE.RFR).toBe('Revenu fiscal de référence');
    expect(GLOSSAIRE.PSU).toBe('Prestation de service unique');
    expect(GLOSSAIRE.ALSH).toBe('Accueil de loisirs sans hébergement');
    // ABCM est explicité (libellé non vide).
    expect(GLOSSAIRE.ABCM.length).toBeGreaterThan(0);
  });

  describe('estSigleConnu', () => {
    it('reconnaît un sigle présent', () => {
      expect(estSigleConnu('RFR')).toBe(true);
    });

    it('rejette un sigle absent', () => {
      expect(estSigleConnu('XYZ')).toBe(false);
    });
  });

  describe('libelleSigle', () => {
    it('retourne le libellé long pour une clé connue', () => {
      expect(libelleSigle('PSU')).toBe('Prestation de service unique');
    });

    it('retourne undefined pour une clé inconnue', () => {
      expect(libelleSigle('XYZ')).toBeUndefined();
    });
  });
});
