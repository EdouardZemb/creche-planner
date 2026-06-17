import { describe, expect, it } from 'vitest';
import { PeriodeValidite } from './periode-validite.js';
import {
  selectionnerVersionApplicable,
  verifierAbsenceChevauchement,
} from './catalogue-versionne.js';
import {
  AucuneVersionApplicableError,
  VersionsChevauchantesError,
} from './referentiel-error.js';

interface VersionTest {
  readonly periode: PeriodeValidite;
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
    // ordre d'entrée inverse : le reduce doit toujours retenir la plus récente.
    expect(
      selectionnerVersionApplicable([recente, ancienne], '2026-09-15').label,
    ).toBe('recente');
  });
});

describe('verifierAbsenceChevauchement', () => {
  it('accepte des périodes disjointes', () => {
    expect(() =>
      verifierAbsenceChevauchement([
        PeriodeValidite.creer('2025-01-01', '2025-12-31'),
        PeriodeValidite.creer('2026-01-01', '2026-12-31'),
      ]),
    ).not.toThrow();
  });

  it('lève si deux périodes se chevauchent (la courante ouverte)', () => {
    expect(() =>
      verifierAbsenceChevauchement([
        PeriodeValidite.creer('2026-06-01'),
        PeriodeValidite.creer('2026-01-01', '2026-12-31'),
      ]),
    ).toThrow(VersionsChevauchantesError);
  });

  it('lève si deux périodes se chevauchent (l’autre ouverte)', () => {
    expect(() =>
      verifierAbsenceChevauchement([
        PeriodeValidite.creer('2026-01-01', '2026-06-30'),
        PeriodeValidite.creer('2026-06-01'),
      ]),
    ).toThrow(VersionsChevauchantesError);
  });
});
