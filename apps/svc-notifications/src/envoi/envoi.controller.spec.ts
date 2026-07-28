import { describe, expect, it, vi } from 'vitest';
import { BadRequestException } from '@nestjs/common';
import { EnvoiController } from './envoi.controller.js';
import type { EnvoiService } from './envoi.service.js';
import type { SuiviEnvoisService } from './suivi-envois.service.js';

/**
 * Contrôleur d'envoi : on couvre ici la route **mois communiqués** (SFD 30, US-30-05,
 * lecture seule) — délégation au service et validation des bornes `du`/`au`. Les envois
 * réels et le suivi par semaine sont exercés en intégration/pact (stack réelle).
 */

const FOYER = '22222222-2222-4222-8222-222222222222';

function controleur(suivis: Partial<SuiviEnvoisService>): EnvoiController {
  return new EnvoiController(
    {} as unknown as EnvoiService,
    suivis as unknown as SuiviEnvoisService,
  );
}

describe('EnvoiController.moisCommuniques (SFD 30)', () => {
  it('délègue au service avec les bornes du/au', async () => {
    const moisCommuniques = vi.fn(async () => ({ mois: ['2026-06'] }));
    const ctrl = controleur({ moisCommuniques });

    const res = await ctrl.moisCommuniques(FOYER, '2026-06', '2026-08');
    expect(res).toEqual({ mois: ['2026-06'] });
    expect(moisCommuniques).toHaveBeenCalledWith(FOYER, '2026-06', '2026-08');
  });

  it('accepte l’absence de bornes (undefined)', async () => {
    const moisCommuniques = vi.fn(async () => ({ mois: [] }));
    const ctrl = controleur({ moisCommuniques });

    await ctrl.moisCommuniques(FOYER, undefined, undefined);
    expect(moisCommuniques).toHaveBeenCalledWith(FOYER, undefined, undefined);
  });

  it('rejette une borne mal formée (400)', () => {
    const ctrl = controleur({ moisCommuniques: vi.fn() });
    expect(() => ctrl.moisCommuniques(FOYER, '2026-13', undefined)).toThrow(
      BadRequestException,
    );
    expect(() => ctrl.moisCommuniques(FOYER, undefined, 'juin')).toThrow(
      BadRequestException,
    );
  });
});
