import { BadRequestException } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';
import { CoutController } from './cout.controller.js';
import type { CoutService } from './cout.service.js';

/**
 * Gardes de paramètres de l'API « coût » : le contrôleur ne fait que valider la
 * requête avant de déléguer au service. On teste donc **les refus** (400) et le
 * fait que les valeurs acceptées soient relayées telles quelles — dont
 * `simule=true` seul (toute autre valeur vaut `false`).
 *
 * Le format de mois est **borné 01-12** (AQ-04, doc 27) : l'ancienne expression
 * `\d{2}` acceptait « 2026-13 ». Le cas est verrouillé ici.
 */

const FOYER = '11111111-2222-3333-4444-555555555555';

function controleur(): {
  ctrl: CoutController;
  coutMois: ReturnType<typeof vi.fn>;
  coutAnnuel: ReturnType<typeof vi.fn>;
} {
  const coutMois = vi.fn(() => Promise.resolve({ mois: true }));
  const coutAnnuel = vi.fn(() => Promise.resolve({ annuel: true }));
  const service = { coutMois, coutAnnuel } as unknown as CoutService;
  return { ctrl: new CoutController(service), coutMois, coutAnnuel };
}

describe('CoutController — gardes de paramètres', () => {
  it('relaie (foyer, mois, simule) au service quand tout est valide', async () => {
    const { ctrl, coutMois } = controleur();

    await ctrl.coutMois(FOYER, '2026-01', 'true');

    expect(coutMois).toHaveBeenCalledWith(FOYER, '2026-01', true);
  });

  it('traite toute valeur de `simule` autre que « true » comme false', async () => {
    const { ctrl, coutMois } = controleur();

    await ctrl.coutMois(FOYER, '2026-01', '1');
    await ctrl.coutMois(FOYER, '2026-01', undefined);

    expect(coutMois).toHaveBeenNthCalledWith(1, FOYER, '2026-01', false);
    expect(coutMois).toHaveBeenNthCalledWith(2, FOYER, '2026-01', false);
  });

  it.each([
    ['absent', undefined],
    ['non-UUID', 'foyer-1'],
  ])('refuse un foyer %s (400)', (_cas, foyerId) => {
    const { ctrl } = controleur();

    expect(() => ctrl.coutMois(foyerId, '2026-01')).toThrow(
      BadRequestException,
    );
  });

  it.each([
    ['absent', undefined],
    ['mal formé', '2026/01'],
    ['hors bornes 01-12', '2026-13'],
  ])('refuse un mois %s (400)', (_cas, mois) => {
    const { ctrl } = controleur();

    expect(() => ctrl.coutMois(FOYER, mois)).toThrow(BadRequestException);
  });

  it('relaie l’année en nombre au service', async () => {
    const { ctrl, coutAnnuel } = controleur();

    await ctrl.coutAnnuel(FOYER, '2026', 'true');

    expect(coutAnnuel).toHaveBeenCalledWith(FOYER, 2026, true);
  });

  it.each([
    ['absente', undefined],
    ['mal formée', '26'],
  ])('refuse une année %s (400)', (_cas, annee) => {
    const { ctrl } = controleur();

    expect(() => ctrl.coutAnnuel(FOYER, annee)).toThrow(BadRequestException);
  });

  it('refuse aussi un foyer invalide sur la route annuelle (400)', () => {
    const { ctrl } = controleur();

    expect(() => ctrl.coutAnnuel('pas-un-uuid', '2026')).toThrow(
      BadRequestException,
    );
  });
});

/**
 * Confusion de type par altération de paramètre (CodeQL
 * `js/type-confusion-through-parameter-tampering`, alertes #20/#21).
 *
 * Express parse `?mois[]=2026-01` en **tableau**. `RegExp.test` stringifiant son
 * argument, `['2026-01']` satisfaisait la regex tout en restant un tableau : il
 * traversait la garde typé `string`, et en aval `mois.slice(0, 4)` rendait un
 * tableau — donc `Number(...)` un `NaN`, et les frais fixes ABCM de première
 * année n'étaient jamais facturés. Aucune erreur, juste un montant faux.
 *
 * Les gardes testent désormais `typeof === 'string'` d'abord : un tableau à un
 * seul élément doit être **refusé**, pas déplié.
 */
describe('CoutController — altération de paramètre (tableau)', () => {
  it('refuse un mois passé en tableau à un élément (400)', () => {
    const { ctrl, coutMois } = controleur();

    expect(() => ctrl.coutMois(FOYER, ['2026-01'])).toThrow(
      BadRequestException,
    );
    expect(coutMois).not.toHaveBeenCalled();
  });

  it('refuse un foyer passé en tableau à un élément (400)', () => {
    const { ctrl, coutMois } = controleur();

    expect(() => ctrl.coutMois([FOYER], '2026-01')).toThrow(
      BadRequestException,
    );
    expect(coutMois).not.toHaveBeenCalled();
  });

  it('refuse une année passée en tableau à un élément (400)', () => {
    const { ctrl, coutAnnuel } = controleur();

    expect(() => ctrl.coutAnnuel(FOYER, ['2026'])).toThrow(BadRequestException);
    expect(coutAnnuel).not.toHaveBeenCalled();
  });
});
