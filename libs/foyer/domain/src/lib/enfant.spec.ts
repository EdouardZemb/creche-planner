import { describe, expect, it } from 'vitest';
import { Enfant } from './enfant.js';
import {
  DateNaissanceInvalideError,
  PrenomInvalideError,
} from './foyer-error.js';

describe('Enfant (value object de composition du foyer)', () => {
  it('se construit à partir d’un prénom et d’une date de naissance', () => {
    const mia = Enfant.creer({
      prenom: 'Mia',
      dateNaissance: new Date('2024-12-08'),
    });
    expect(mia.prenom).toBe('Mia');
    expect(mia.dateNaissance.toISOString().slice(0, 10)).toBe('2024-12-08');
  });

  it('rogne les espaces superflus du prénom', () => {
    expect(
      Enfant.creer({
        prenom: '  Zoé ',
        dateNaissance: new Date('2023-03-12'),
      }).prenom,
    ).toBe('Zoé');
  });

  it('refuse un prénom vide ou uniquement composé d’espaces', () => {
    expect(() =>
      Enfant.creer({ prenom: '   ', dateNaissance: new Date('2023-03-12') }),
    ).toThrow(PrenomInvalideError);
  });

  it('refuse une date de naissance non interprétable', () => {
    expect(() =>
      Enfant.creer({ prenom: 'Mia', dateNaissance: new Date('pas-une-date') }),
    ).toThrow(DateNaissanceInvalideError);
  });

  it('expose une copie défensive de la date (immutabilité)', () => {
    const enfant = Enfant.creer({
      prenom: 'Mia',
      dateNaissance: new Date('2024-12-08'),
    });
    const lue = enfant.dateNaissance;
    lue.setFullYear(1900);
    expect(enfant.dateNaissance.getFullYear()).toBe(2024);
  });

  describe('égalité (par valeur)', () => {
    const mia = Enfant.creer({
      prenom: 'Mia',
      dateNaissance: new Date('2024-12-08'),
    });

    it('vraie pour mêmes prénom et date', () => {
      expect(
        mia.egale(
          Enfant.creer({
            prenom: 'Mia',
            dateNaissance: new Date('2024-12-08'),
          }),
        ),
      ).toBe(true);
    });

    it('fausse si le prénom diffère', () => {
      expect(
        mia.egale(
          Enfant.creer({
            prenom: 'Zoé',
            dateNaissance: new Date('2024-12-08'),
          }),
        ),
      ).toBe(false);
    });

    it('fausse si la date diffère', () => {
      expect(
        mia.egale(
          Enfant.creer({
            prenom: 'Mia',
            dateNaissance: new Date('2023-03-12'),
          }),
        ),
      ).toBe(false);
    });
  });

  it('se représente en chaîne lisible', () => {
    expect(
      Enfant.creer({
        prenom: 'Zoé',
        dateNaissance: new Date('2023-03-12'),
      }).toString(),
    ).toBe('Zoé (2023-03-12)');
  });
});
