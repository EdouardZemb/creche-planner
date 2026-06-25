import { describe, expect, it, vi } from 'vitest';
import { ValidationController } from './validation.controller.js';
import type { ValidationService } from './validation.service.js';
import type {
  NotificationAValiderVue,
  ValidationResultat,
} from './validation.dto.js';

const VUE: NotificationAValiderVue = {
  contratId: '55555555-0000-4000-8000-000000000000',
  foyerId: '22222222-2222-4222-8222-222222222222',
  semaineIso: '2026-W27',
  statut: 'A_VALIDER',
  notifieeLe: '2026-06-23T06:00:00.000Z',
};

const RESULTAT: ValidationResultat = {
  contratId: VUE.contratId,
  semaineIso: VUE.semaineIso,
  statut: 'VALIDEE',
  deltaModifs: null,
};

function controleur(overrides: Partial<ValidationService> = {}) {
  const service = {
    aValider: vi.fn().mockResolvedValue([VUE]),
    valider: vi.fn().mockResolvedValue(RESULTAT),
    ...overrides,
  } as unknown as ValidationService;
  return { service, ctrl: new ValidationController(service) };
}

describe('ValidationController', () => {
  it('liste les semaines à valider d’un foyer', async () => {
    const { ctrl, service } = controleur();
    await expect(ctrl.aValider(VUE.foyerId)).resolves.toEqual([VUE]);
    expect(service.aValider).toHaveBeenCalledWith(VUE.foyerId);
  });

  it('valide une semaine et relaie au service', async () => {
    const { ctrl, service } = controleur();
    await expect(ctrl.valider(VUE.contratId, VUE.semaineIso)).resolves.toEqual(
      RESULTAT,
    );
    expect(service.valider).toHaveBeenCalledWith(VUE.contratId, VUE.semaineIso);
  });
});
