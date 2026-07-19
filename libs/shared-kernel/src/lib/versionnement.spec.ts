import { describe, expect, it } from 'vitest';
import {
  cloreVersionPrecedente,
  depuisBornes,
  depuisSuite,
  PeriodeValidite,
  selectionnerVersionApplicable,
  verifierAbsenceChevauchement,
  verifierContinuite,
  type Versionne,
} from './versionnement.js';
import {
  AucuneVersionApplicableError,
  ChevauchementVersionsError,
  PeriodeInvalideError,
  TrouDansVersionsError,
} from './domain-error.js';

describe('PeriodeValidite', () => {
  it('rejette une date de début mal formée', () => {
    expect(() => PeriodeValidite.creer('2026/01/01')).toThrow(
      PeriodeInvalideError,
    );
  });

  it('rejette une date de fin mal formée', () => {
    expect(() => PeriodeValidite.creer('2026-01-01', '01-01-2027')).toThrow(
      PeriodeInvalideError,
    );
  });

  it('rejette une fin antérieure au début', () => {
    expect(() => PeriodeValidite.creer('2026-09-01', '2026-08-31')).toThrow(
      PeriodeInvalideError,
    );
  });

  it('accepte une période bornée', () => {
    const p = PeriodeValidite.creer('2026-01-01', '2026-12-31');
    expect(p.du).toBe('2026-01-01');
    expect(p.au).toBe('2026-12-31');
  });

  it('accepte une période ouverte (sans fin)', () => {
    const p = PeriodeValidite.creer('2026-01-01');
    expect(p.au).toBeUndefined();
  });

  describe('contient', () => {
    it('exclut une date avant le début', () => {
      const p = PeriodeValidite.creer('2026-01-01', '2026-12-31');
      expect(p.contient('2025-12-31')).toBe(false);
    });

    it('exclut une date après la fin', () => {
      const p = PeriodeValidite.creer('2026-01-01', '2026-12-31');
      expect(p.contient('2027-01-01')).toBe(false);
    });

    it('inclut une date dans une période bornée (bornes incluses)', () => {
      const p = PeriodeValidite.creer('2026-01-01', '2026-12-31');
      expect(p.contient('2026-01-01')).toBe(true);
      expect(p.contient('2026-12-31')).toBe(true);
    });

    it('inclut toute date ≥ début pour une période ouverte', () => {
      const p = PeriodeValidite.creer('2026-01-01');
      expect(p.contient('2099-01-01')).toBe(true);
    });
  });

  describe('chevauche', () => {
    const bornee = (du: string, au: string) => PeriodeValidite.creer(du, au);

    it('détecte deux périodes bornées qui se recouvrent', () => {
      expect(
        bornee('2026-01-01', '2026-06-30').chevauche(
          bornee('2026-06-01', '2026-12-31'),
        ),
      ).toBe(true);
    });

    it('ignore deux périodes bornées disjointes (la première avant)', () => {
      expect(
        bornee('2026-01-01', '2026-05-31').chevauche(
          bornee('2026-06-01', '2026-12-31'),
        ),
      ).toBe(false);
    });

    it('ignore deux périodes bornées disjointes (la première après)', () => {
      expect(
        bornee('2026-07-01', '2026-12-31').chevauche(
          bornee('2026-01-01', '2026-06-30'),
        ),
      ).toBe(false);
    });

    it('détecte un recouvrement quand la période courante est ouverte', () => {
      expect(
        PeriodeValidite.creer('2026-01-01').chevauche(
          bornee('2027-01-01', '2027-12-31'),
        ),
      ).toBe(true);
    });

    it('détecte un recouvrement quand l’autre période est ouverte', () => {
      expect(
        bornee('2027-01-01', '2027-12-31').chevauche(
          PeriodeValidite.creer('2026-01-01'),
        ),
      ).toBe(true);
    });
  });
});

describe('cloreVersionPrecedente', () => {
  it('renvoie la veille en milieu de mois', () => {
    expect(cloreVersionPrecedente('2026-09-15')).toBe('2026-09-14');
  });

  it('absorbe la frontière de mois (mois à 31 jours)', () => {
    expect(cloreVersionPrecedente('2026-09-01')).toBe('2026-08-31');
  });

  it('absorbe la frontière de mois (mois à 30 jours)', () => {
    expect(cloreVersionPrecedente('2026-10-01')).toBe('2026-09-30');
  });

  it('absorbe la frontière d’année', () => {
    expect(cloreVersionPrecedente('2026-01-01')).toBe('2025-12-31');
  });

  it('gère février d’une année bissextile', () => {
    expect(cloreVersionPrecedente('2024-03-01')).toBe('2024-02-29');
  });

  it('gère février d’une année non bissextile', () => {
    expect(cloreVersionPrecedente('2026-03-01')).toBe('2026-02-28');
  });

  it('gère février d’une année séculaire divisible par 400 (bissextile)', () => {
    expect(cloreVersionPrecedente('2000-03-01')).toBe('2000-02-29');
  });

  it('rejette une date mal formée', () => {
    expect(() => cloreVersionPrecedente('2026-9-1')).toThrow(
      PeriodeInvalideError,
    );
  });
});

interface VersionTest extends Versionne {
  readonly label: string;
}

const v = (label: string, du: string, au?: string): VersionTest => ({
  label,
  periode: PeriodeValidite.creer(du, au),
});

describe('selectionnerVersionApplicable', () => {
  it('renvoie la version dont la période couvre la date', () => {
    const versions = [
      v('2025', '2025-01-01', '2025-12-31'),
      v('2026', '2026-01-01', '2026-12-31'),
    ];
    expect(selectionnerVersionApplicable(versions, '2026-09-15').label).toBe(
      '2026',
    );
  });

  it('lève si aucune version ne couvre la date', () => {
    const versions = [v('2025', '2025-01-01', '2025-12-31')];
    expect(() => selectionnerVersionApplicable(versions, '2026-09-15')).toThrow(
      AucuneVersionApplicableError,
    );
  });

  it('départage par récence (du maximal) en cas de chevauchement', () => {
    const ancienne = v('ancienne', '2026-01-01');
    const recente = v('recente', '2026-06-01');
    expect(
      selectionnerVersionApplicable([ancienne, recente], '2026-09-15').label,
    ).toBe('recente');
    expect(
      selectionnerVersionApplicable([recente, ancienne], '2026-09-15').label,
    ).toBe('recente');
  });
});

describe('verifierAbsenceChevauchement', () => {
  it('accepte des périodes disjointes', () => {
    expect(() => {
      verifierAbsenceChevauchement([
        PeriodeValidite.creer('2025-01-01', '2025-12-31'),
        PeriodeValidite.creer('2026-01-01', '2026-12-31'),
      ]);
    }).not.toThrow();
  });

  it('lève si deux périodes se chevauchent (la courante ouverte)', () => {
    expect(() => {
      verifierAbsenceChevauchement([
        PeriodeValidite.creer('2026-06-01'),
        PeriodeValidite.creer('2026-01-01', '2026-12-31'),
      ]);
    }).toThrow(ChevauchementVersionsError);
  });

  it('lève si deux périodes se chevauchent (l’autre ouverte)', () => {
    expect(() => {
      verifierAbsenceChevauchement([
        PeriodeValidite.creer('2026-01-01', '2026-06-30'),
        PeriodeValidite.creer('2026-06-01'),
      ]);
    }).toThrow(ChevauchementVersionsError);
  });
});

describe('verifierContinuite', () => {
  it('accepte une suite contiguë (versions touchantes)', () => {
    expect(() => {
      verifierContinuite([
        { periode: PeriodeValidite.creer('2026-01-01', '2026-08-31') },
        { periode: PeriodeValidite.creer('2026-09-01') },
      ]);
    }).not.toThrow();
  });

  it('trie par date de début avant de vérifier (entrée désordonnée)', () => {
    expect(() => {
      verifierContinuite([
        { periode: PeriodeValidite.creer('2026-09-01') },
        { periode: PeriodeValidite.creer('2026-01-01', '2026-08-31') },
      ]);
    }).not.toThrow();
  });

  it('accepte une version unique', () => {
    expect(() => {
      verifierContinuite([{ periode: PeriodeValidite.creer('2026-01-01') }]);
    }).not.toThrow();
  });

  it('lève un trou quand la version précédente s’arrête trop tôt', () => {
    expect(() => {
      verifierContinuite([
        { periode: PeriodeValidite.creer('2026-01-01', '2026-05-31') },
        { periode: PeriodeValidite.creer('2026-09-01') },
      ]);
    }).toThrow(TrouDansVersionsError);
  });

  it('n’est pas un trou quand la version précédente est ouverte', () => {
    expect(() => {
      verifierContinuite([
        { periode: PeriodeValidite.creer('2026-01-01') },
        { periode: PeriodeValidite.creer('2027-01-01') },
      ]);
    }).not.toThrow();
  });

  it('tolère des débuts égaux (le chevauchement est vérifié à part)', () => {
    expect(() => {
      verifierContinuite([
        { periode: PeriodeValidite.creer('2026-01-01', '2026-12-31') },
        { periode: PeriodeValidite.creer('2026-01-01', '2026-12-31') },
      ]);
    }).not.toThrow();
  });
});

describe('depuisBornes', () => {
  it('reprend les bornes explicites du Référentiel (valideAu inclusif)', () => {
    const versions = depuisBornes([
      { valideDu: '2025-01-01', valideAu: '2025-12-31', valeur: 'a' },
      { valideDu: '2026-01-01', valideAu: null, valeur: 'b' },
    ]);
    expect(versions[0]?.periode.du).toBe('2025-01-01');
    expect(versions[0]?.periode.au).toBe('2025-12-31');
    expect(versions[0]?.valeur).toBe('a');
    expect(versions[1]?.periode.au).toBeUndefined();
    expect(versions[1]?.valeur).toBe('b');
  });
});

describe('depuisSuite', () => {
  it('dérive la borne haute (veille de la date d’effet suivante), dernière ouverte', () => {
    const versions = depuisSuite([
      { dateEffet: '2026-01-01', valeur: 'hiver' },
      { dateEffet: '2026-09-01', valeur: 'rentrée' },
    ]);
    expect(versions[0]?.periode.du).toBe('2026-01-01');
    expect(versions[0]?.periode.au).toBe('2026-08-31');
    expect(versions[1]?.periode.du).toBe('2026-09-01');
    expect(versions[1]?.periode.au).toBeUndefined();
    expect(versions[1]?.valeur).toBe('rentrée');
  });

  it('trie les entrées par date d’effet croissante', () => {
    const versions = depuisSuite([
      { dateEffet: '2026-09-01', valeur: 'rentrée' },
      { dateEffet: '2026-01-01', valeur: 'hiver' },
    ]);
    expect(versions.map((x) => x.valeur)).toEqual(['hiver', 'rentrée']);
    expect(versions[0]?.periode.au).toBe('2026-08-31');
  });

  it('rend une version ouverte pour une entrée unique', () => {
    const versions = depuisSuite([{ dateEffet: '2026-01-01', valeur: 'x' }]);
    expect(versions).toHaveLength(1);
    expect(versions[0]?.periode.au).toBeUndefined();
  });

  it('rejette deux dates d’effet identiques (borne dérivée incohérente)', () => {
    expect(() =>
      depuisSuite([
        { dateEffet: '2026-01-01', valeur: 'a' },
        { dateEffet: '2026-01-01', valeur: 'b' },
      ]),
    ).toThrow(PeriodeInvalideError);
  });
});
