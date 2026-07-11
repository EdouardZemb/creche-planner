import { describe, expect, it } from 'vitest';
import {
  anneeScolaireDe,
  estPremiereAnneeAbcm,
  type ContratPremiereAnnee,
} from './premiere-annee-abcm.js';

/** Contrat ABCM de référence, surchageable par cas de test. */
function contrat(
  surcharge: Partial<ContratPremiereAnnee> = {},
): ContratPremiereAnnee {
  return {
    modeAbcm: true,
    premiereInscription: true,
    valideDu: '2026-09-01',
    ...surcharge,
  };
}

describe('anneeScolaireDe (année scolaire = septembre N → août N+1)', () => {
  it('rattache septembre→décembre à l’année civile', () => {
    expect(anneeScolaireDe('2026-09-01')).toBe(2026);
    expect(anneeScolaireDe('2026-12-31')).toBe(2026);
  });

  it('rattache janvier→août à l’année civile précédente', () => {
    expect(anneeScolaireDe('2027-01-15')).toBe(2026);
    expect(anneeScolaireDe('2027-08-31')).toBe(2026);
  });
});

describe('estPremiereAnneeAbcm (doc 02 §4.4 — frais de 1ère inscription)', () => {
  it('contrat marqué démarrant en septembre : true la bonne année scolaire', () => {
    expect(estPremiereAnneeAbcm('2026-09', [contrat()])).toBe(true);
  });

  it('même contrat l’année scolaire suivante : false (cotisation seule)', () => {
    expect(estPremiereAnneeAbcm('2027-09', [contrat()])).toBe(false);
  });

  it('contrat marqué démarrant en janvier : rattaché à l’année scolaire précédente', () => {
    const janvier = contrat({ valideDu: '2027-01-15' });
    expect(estPremiereAnneeAbcm('2026-09', [janvier])).toBe(true);
    expect(estPremiereAnneeAbcm('2027-09', [janvier])).toBe(false);
  });

  it('aucun contrat marqué « première inscription » : false', () => {
    expect(
      estPremiereAnneeAbcm('2026-09', [
        contrat({ premiereInscription: false }),
      ]),
    ).toBe(false);
    expect(estPremiereAnneeAbcm('2026-09', [])).toBe(false);
  });

  it('valideDu inconnu (contrat historique) : contrat ignoré', () => {
    expect(estPremiereAnneeAbcm('2026-09', [contrat({ valideDu: null })])).toBe(
      false,
    );
  });

  it('contrat non-ABCM marqué (cas impossible, défensif) : ignoré', () => {
    expect(
      estPremiereAnneeAbcm('2026-09', [contrat({ modeAbcm: false })]),
    ).toBe(false);
  });

  it('un seul contrat marqué parmi plusieurs suffit', () => {
    expect(
      estPremiereAnneeAbcm('2026-09', [
        contrat({ premiereInscription: false }),
        contrat({ modeAbcm: false }),
        contrat(),
      ]),
    ).toBe(true);
  });
});
