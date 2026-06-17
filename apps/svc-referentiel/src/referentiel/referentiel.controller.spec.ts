import { describe, expect, it, vi } from 'vitest';
import { BadRequestException } from '@nestjs/common';
import { ReferentielController } from './referentiel.controller.js';
import { type ReferentielService } from './referentiel.service.js';

/**
 * AQ-04 (doc 27) — BVA sur le paramètre `date` des routes de lecture : la
 * validation doit porter sur le **calendrier réel** (mois 01-12, jour selon le
 * mois, années bissextiles), pas sur la seule forme `\d{4}-\d{2}-\d{2}`.
 * NB : la garde lève AVANT l'appel au service (méthodes non-async), d'où les
 * assertions synchrones `toThrow`.
 */
function controleur(service: Partial<ReferentielService> = {}) {
  return new ReferentielController(service as ReferentielService);
}

describe('ReferentielController — validation calendaire des dates (AQ-04)', () => {
  const DATES_INVALIDES = [
    '2026-13-45', // mois 13, jour 45 (cas de l'audit — passait la regex)
    '2026-02-30', // 30 février
    '2023-02-29', // 29 février d'une année non bissextile
    '2026-00-10', // mois 00
    '2026-12-32', // jour 32
    '2026-1-5', // format non zéro-paddé
    '12/06/2026', // format français
    '', // vide
  ];

  const DATES_VALIDES = [
    '2026-01-01',
    '2026-02-28',
    '2024-02-29', // bissextile : valide
    '2026-12-31',
  ];

  it.each(DATES_INVALIDES)(
    'rejette « %s » en 400 sur /grilles/applicable',
    (date) => {
      const grilleApplicable = vi.fn();
      const ctrl = controleur({ grilleApplicable });
      expect(() => ctrl.grilleApplicable(date, 'CANTINE', '3')).toThrow(
        BadRequestException,
      );
      expect(grilleApplicable).not.toHaveBeenCalled();
    },
  );

  it('rejette une date absente en 400', () => {
    expect(() =>
      controleur().grilleApplicable(undefined, 'CANTINE', '3'),
    ).toThrow(/format YYYY-MM-DD/);
  });

  it.each(DATES_VALIDES)(
    'transmet « %s » au service (grille applicable)',
    async (date) => {
      const grilleApplicable = vi
        .fn<ReferentielService['grilleApplicable']>()
        .mockResolvedValue({} as never);
      const ctrl = controleur({ grilleApplicable });
      await ctrl.grilleApplicable(date, 'CANTINE', '3');
      expect(grilleApplicable).toHaveBeenCalledWith(date, 'CANTINE', 3);
    },
  );

  it('applique la même validation sur /frais-fixes/applicable', async () => {
    const fraisFixesApplicable = vi
      .fn<ReferentielService['fraisFixesApplicable']>()
      .mockResolvedValue({} as never);
    const ctrl = controleur({ fraisFixesApplicable });
    expect(() => ctrl.fraisFixesApplicable('2026-02-30')).toThrow(
      BadRequestException,
    );
    await ctrl.fraisFixesApplicable('2026-09-01');
    expect(fraisFixesApplicable).toHaveBeenCalledWith('2026-09-01');
  });
});
