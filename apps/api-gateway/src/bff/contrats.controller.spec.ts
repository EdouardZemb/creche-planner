import { describe, expect, it, vi } from 'vitest';
import { BadRequestException } from '@nestjs/common';
import type { PlanificationClient } from '../clients/planification.client.js';
import { ContratsController } from './contrats.controller.js';

/**
 * Façade BFF `/api/v1/contrats` : validation de frontière (forme minimale) puis
 * relais au client planification. Les routes **versionnement** (SFD 30 lot 4)
 * sont couvertes ici : avenant, historique, aperçu d'impact, correction — et la
 * modification qui vise désormais la version courante (non destructive).
 */

const VUE = {
  id: 'c-1',
  foyerId: 'f-1',
  enfant: 'Mia',
  enfantId: 'e-1',
  mode: 'CRECHE_PSU',
  valideDu: '2026-01-01',
  valideAu: null,
};

function fakeClient(): PlanificationClient {
  return {
    listerContrats: vi.fn(async () => [VUE]),
    creerContrat: vi.fn(async () => VUE),
    modifierContrat: vi.fn(async () => VUE),
    creerAvenant: vi.fn(async () => VUE),
    listerVersions: vi.fn(async () => [{ id: 'v-1' }]),
    apercuImpactVersion: vi.fn(async () => ({
      versionId: 'v-1',
      moisCouverts: ['2026-06'],
    })),
    corrigerVersion: vi.fn(async () => VUE),
    supprimerContrat: vi.fn(async () => undefined),
    lirePlanning: vi.fn(async () => ({ saisie: null })),
    ecrirePlanning: vi.fn(async () => undefined),
    ecrireSemaine: vi.fn(async () => undefined),
  } as unknown as PlanificationClient;
}

const AVENANT = {
  mode: 'CRECHE_PSU',
  dateEffet: '2026-09-01',
  heuresAnnuellesContractualisees: 700,
  nbMensualites: 7,
  semaineType: {},
};

describe('ContratsController (BFF versionnement, SFD 30 lot 4)', () => {
  it('POST :id/versions valide la forme minimale puis relaie l’avenant', async () => {
    const client = fakeClient();
    const controller = new ContratsController(client);

    const vue = await controller.creerAvenant('c-1', AVENANT);
    expect(vue.id).toBe('c-1');
    expect(client.creerAvenant).toHaveBeenCalledWith(
      'c-1',
      expect.objectContaining({ dateEffet: '2026-09-01' }),
    );
  });

  it('POST :id/versions sans dateEffet → 400 (frontière), client jamais appelé', async () => {
    const client = fakeClient();
    const controller = new ContratsController(client);

    expect(() =>
      controller.creerAvenant('c-1', { mode: 'CRECHE_PSU' }),
    ).toThrowError(BadRequestException);
    expect(client.creerAvenant).not.toHaveBeenCalled();
  });

  it('GET :id/versions et :id/versions/:versionId/impact relaient la lecture', async () => {
    const client = fakeClient();
    const controller = new ContratsController(client);

    const versions = await controller.listerVersions('c-1');
    expect(versions).toHaveLength(1);
    const impact = await controller.apercuImpact('c-1', 'v-1');
    expect(impact.moisCouverts).toEqual(['2026-06']);
    expect(client.apercuImpactVersion).toHaveBeenCalledWith('c-1', 'v-1');
  });

  it('PUT :id/versions/:versionId valide le mode puis relaie la correction', async () => {
    const client = fakeClient();
    const controller = new ContratsController(client);

    await controller.corrigerVersion('c-1', 'v-1', {
      mode: 'CRECHE_PSU',
      heuresAnnuellesContractualisees: 700,
    });
    expect(client.corrigerVersion).toHaveBeenCalledWith(
      'c-1',
      'v-1',
      expect.objectContaining({ mode: 'CRECHE_PSU' }),
    );
  });

  it('PUT :id (modification) relaie vers la correction de version courante', async () => {
    const client = fakeClient();
    const controller = new ContratsController(client);

    const vue = await controller.modifier('c-1', {
      mode: 'CRECHE_PSU',
      foyerId: 'f-1',
      enfant: 'Mia',
      enfantId: 'e-1',
      valideDu: '2026-01-01',
      valideAu: null,
    });
    expect(vue.id).toBe('c-1');
    expect(client.modifierContrat).toHaveBeenCalledWith(
      'c-1',
      expect.objectContaining({ mode: 'CRECHE_PSU' }),
    );
  });

  it('GET sans paramètre foyer → 400', async () => {
    const controller = new ContratsController(fakeClient());
    expect(() => controller.lister(undefined)).toThrowError(
      BadRequestException,
    );
  });
});
