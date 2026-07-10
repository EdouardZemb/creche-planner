import { describe, it, expect } from 'vitest';
import {
  LIBELLES_MODE,
  estFraisFixesAbcm,
  titrePrestationCout,
} from './libelles';

describe('LIBELLES_MODE', () => {
  it('expose un libellé accentué pour chaque mode', () => {
    // « PSU » (sigle de financement) ne doit pas apparaître côté parent (UX lot 2).
    expect(LIBELLES_MODE.CRECHE_PSU).toBe('Crèche');
    expect(LIBELLES_MODE.CANTINE).toBe('Cantine');
    expect(LIBELLES_MODE.PERISCOLAIRE).toBe('Périscolaire');
    expect(LIBELLES_MODE.ALSH).toBe('ALSH');
  });

  it("n'affiche jamais le mode brut", () => {
    expect(LIBELLES_MODE.CRECHE_PSU).not.toBe('CRECHE_PSU');
  });
});

describe('estFraisFixesAbcm', () => {
  it('reconnaît le pseudo-mode des frais fixes annuels', () => {
    expect(estFraisFixesAbcm('FRAIS_FIXES_ABCM')).toBe(true);
  });

  it('rejette les modes de contrat ordinaires', () => {
    expect(estFraisFixesAbcm('CRECHE_PSU')).toBe(false);
    expect(estFraisFixesAbcm('CANTINE')).toBe(false);
  });
});

describe('titrePrestationCout (lot 2 qualité Coûts)', () => {
  it('cas général : « <enfant> — <mode accentué> »', () => {
    expect(titrePrestationCout('Emma', 'CRECHE_PSU')).toBe('Emma — Crèche');
    expect(titrePrestationCout('Léo', 'PERISCOLAIRE')).toBe(
      'Léo — Périscolaire',
    );
  });

  it('frais fixes annuels : « Frais annuels — ABCM », sans prénom ni code brut', () => {
    const titre = titrePrestationCout('', 'FRAIS_FIXES_ABCM');
    expect(titre).toBe('Frais annuels — ABCM');
    expect(titre).not.toContain('FRAIS_FIXES');
  });

  it('mode inconnu : repli sur la valeur brute (comportement libelleMode)', () => {
    expect(titrePrestationCout('Emma', 'AUTRE')).toBe('Emma — AUTRE');
  });
});
