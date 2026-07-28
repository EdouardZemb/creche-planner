import { describe, expect, it, vi } from 'vitest';
import { BadRequestException } from '@nestjs/common';
import { Duree } from '@creche-planner/shared-kernel';
import type { PrestationsMoisCreche } from '@creche-planner/planification-domain';
import { PlanificationController } from './planification.controller.js';
import type { PlanificationService } from './planification.service.js';

/**
 * Tests unitaires du contrôleur (sans Nest ni HTTP) : délégation au service,
 * gardes de format (`mois`, `semaineIso`) et sérialisation des prestations
 * (les `Duree` crèche → minutes entières). Les guards de scoping sont couverts
 * par `security/scope-foyer.integration.spec.ts`.
 */

const CONTRAT_ID = '55555555-5555-4555-8555-555555555555';
const VERSION_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';

const VUE = { id: CONTRAT_ID, mode: 'CRECHE_PSU' };

function fakeService(): PlanificationService {
  const prestaCreche: PrestationsMoisCreche = {
    mode: 'CRECHE_PSU',
    heuresAnnuellesContractualisees: 885.5,
    nbMensualites: 7,
    heuresMensualisees: 126.5,
    complement: Duree.depuisMinutes(30),
    heuresReservees: Duree.depuisMinutes(510),
    heuresDeduites: Duree.depuisMinutes(0),
  };
  return {
    listerContrats: vi.fn(async () => [VUE]),
    lireContrat: vi.fn(async () => VUE),
    creerContrat: vi.fn(async () => VUE),
    creerAvenant: vi.fn(async () => VUE),
    listerVersions: vi.fn(async () => [{ id: VERSION_ID }]),
    apercuImpactVersion: vi.fn(async () => ({
      versionId: VERSION_ID,
      moisCouverts: ['2026-06'],
    })),
    corrigerVersion: vi.fn(async () => VUE),
    corrigerVersionCourante: vi.fn(async () => VUE),
    rattacherEtablissement: vi.fn(async () => VUE),
    rattacherEnfant: vi.fn(async () => VUE),
    supprimerContrat: vi.fn(async () => undefined),
    ecrirePlanning: vi.fn(async () => undefined),
    ecrireSemaine: vi.fn(async () => undefined),
    lirePlanning: vi.fn(async () => null),
    prestationsMois: vi.fn(async () => ({
      mois: '2026-10',
      prestations: [prestaCreche],
    })),
  } as unknown as PlanificationService;
}

const AVENANT = {
  mode: 'CRECHE_PSU' as const,
  dateEffet: '2026-09-01',
  heuresAnnuellesContractualisees: 700,
  nbMensualites: 7,
  semaineType: {},
};

describe('PlanificationController (délégation + gardes de format)', () => {
  it('relaie les routes versionnement au service (avenant, historique, impact, corrections)', async () => {
    const service = fakeService();
    const controller = new PlanificationController(service);

    await controller.creerAvenant(CONTRAT_ID, AVENANT as never);
    expect(service.creerAvenant).toHaveBeenCalledWith(CONTRAT_ID, AVENANT);

    await controller.listerVersions(CONTRAT_ID);
    expect(service.listerVersions).toHaveBeenCalledWith(CONTRAT_ID);

    const impact = await controller.apercuImpact(CONTRAT_ID, VERSION_ID);
    expect(impact.moisCouverts).toEqual(['2026-06']);

    await controller.corrigerVersion(CONTRAT_ID, VERSION_ID, AVENANT as never);
    expect(service.corrigerVersion).toHaveBeenCalledWith(
      CONTRAT_ID,
      VERSION_ID,
      AVENANT,
    );

    await controller.corrigerVersionCourante(CONTRAT_ID, AVENANT as never);
    expect(service.corrigerVersionCourante).toHaveBeenCalledWith(
      CONTRAT_ID,
      AVENANT,
    );
  });

  it('relaie lecture/écriture (contrats, plannings, suppression, rattachements)', async () => {
    const service = fakeService();
    const controller = new PlanificationController(service);

    await controller.listerContrats('f');
    await controller.lireContrat(CONTRAT_ID);
    await controller.creerContrat({} as never);
    await controller.supprimerContrat(CONTRAT_ID);
    await controller.rattacherEtablissement(CONTRAT_ID, {
      etablissementId: 'e',
    });
    await controller.rattacherEnfant(CONTRAT_ID, { enfantId: 'e' });
    await controller.ecrirePlanning(CONTRAT_ID, '2026-10', {}, 'true');
    expect(service.ecrirePlanning).toHaveBeenCalledWith(
      CONTRAT_ID,
      '2026-10',
      true,
      {},
    );
    await controller.ecrireSemaine(CONTRAT_ID, '2026-W41', {}, 'false');
    expect(service.ecrireSemaine).toHaveBeenCalledWith(
      CONTRAT_ID,
      '2026-W41',
      false,
      {},
    );
    const relu = await controller.lirePlanning(CONTRAT_ID, '2026-10');
    expect(relu).toEqual({ saisie: null });
  });

  it('sérialise les prestations crèche (Duree → minutes) et relaie simule', async () => {
    const service = fakeService();
    const controller = new PlanificationController(service);

    const reponse = await controller.prestations(CONTRAT_ID, '2026-10', 'true');
    expect(reponse.simule).toBe(true);
    expect(reponse.prestations[0]).toMatchObject({
      mode: 'CRECHE_PSU',
      complementMinutes: 30,
      heuresReserveesMinutes: 510,
      heuresDeduitesMinutes: 0,
    });
  });

  it('sérialise une prestation non crèche telle quelle (spread)', async () => {
    const service = fakeService();
    (
      service.prestationsMois as unknown as ReturnType<typeof vi.fn>
    ).mockResolvedValue({
      mois: '2026-10',
      prestations: [{ mode: 'CANTINE', nbJours: 3, pai: false }],
    });
    const controller = new PlanificationController(service);

    const reponse = await controller.prestations(
      CONTRAT_ID,
      '2026-10',
      'false',
    );
    expect(reponse.prestations[0]).toEqual({
      mode: 'CANTINE',
      nbJours: 3,
      pai: false,
    });
  });

  it('refuse un mois mal formé (400) et une semaine ISO mal formée (400)', async () => {
    const controller = new PlanificationController(fakeService());

    await expect(
      controller.lirePlanning(CONTRAT_ID, '2026-13'),
    ).rejects.toBeInstanceOf(BadRequestException);
    await expect(
      controller.prestations(CONTRAT_ID, undefined),
    ).rejects.toBeInstanceOf(BadRequestException);
    await expect(
      controller.ecrirePlanning(CONTRAT_ID, 'octobre', {}),
    ).rejects.toBeInstanceOf(BadRequestException);
    await expect(
      controller.ecrireSemaine(CONTRAT_ID, '2026-10', {}),
    ).rejects.toBeInstanceOf(BadRequestException);
  });
});
