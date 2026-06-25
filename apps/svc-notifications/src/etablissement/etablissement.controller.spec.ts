import { BadRequestException } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';
import { EtablissementController } from './etablissement.controller.js';
import type {
  EtablissementService,
  EtablissementVue,
} from './etablissement.service.js';
import type { UpsertEtablissementDto } from './etablissement.dto.js';

const VUE: EtablissementVue = {
  cle: 'CRECHE_HIRONDELLES',
  libelle: 'Crèche Les Hirondelles',
  emailService: 'creche@example.org',
  preavisRegle: { type: 'JOURS_OUVRES', valeur: 2 },
  actif: true,
};

function controleur(overrides: Partial<EtablissementService> = {}) {
  const service = {
    lister: vi.fn().mockResolvedValue([VUE]),
    upsert: vi.fn().mockResolvedValue(VUE),
    ...overrides,
  } as unknown as EtablissementService;
  return { service, ctrl: new EtablissementController(service) };
}

const DTO: UpsertEtablissementDto = {
  emailService: 'creche@example.org',
  preavisRegle: { type: 'JOURS_OUVRES', valeur: 2 },
};

describe('EtablissementController', () => {
  it('liste les établissements', async () => {
    const { ctrl, service } = controleur();
    await expect(ctrl.lister()).resolves.toEqual([VUE]);
    expect(service.lister).toHaveBeenCalledOnce();
  });

  it('upsert une clé connue et relaie au service', async () => {
    const { ctrl, service } = controleur();
    await expect(ctrl.upsert('CRECHE_HIRONDELLES', DTO)).resolves.toEqual(VUE);
    expect(service.upsert).toHaveBeenCalledWith('CRECHE_HIRONDELLES', DTO);
  });

  it('rejette une clé inconnue (400) sans appeler le service', () => {
    const { ctrl, service } = controleur();
    expect(() => ctrl.upsert('INCONNU', DTO)).toThrow(BadRequestException);
    expect(service.upsert).not.toHaveBeenCalled();
  });
});
