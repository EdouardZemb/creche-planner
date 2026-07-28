import { describe, expect, it, vi } from 'vitest';
import { BadRequestException } from '@nestjs/common';
import type { PlanificationClient } from '../clients/planification.client.js';
import type { NotificationsClient } from '../clients/notifications.client.js';
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
    contrat: vi.fn(async () => VUE),
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

/** Client notifications simulé : par défaut, aucun mois communiqué. */
function fakeNotifications(
  moisCommuniques: string[] = [],
): NotificationsClient {
  return {
    moisCommuniques: vi.fn(async () => moisCommuniques),
  } as unknown as NotificationsClient;
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
    const controller = new ContratsController(client, fakeNotifications());

    const vue = await controller.creerAvenant('c-1', AVENANT);
    expect(vue.id).toBe('c-1');
    expect(client.creerAvenant).toHaveBeenCalledWith(
      'c-1',
      expect.objectContaining({ dateEffet: '2026-09-01' }),
    );
  });

  it('POST :id/versions sans dateEffet → 400 (frontière), client jamais appelé', async () => {
    const client = fakeClient();
    const controller = new ContratsController(client, fakeNotifications());

    expect(() =>
      controller.creerAvenant('c-1', { mode: 'CRECHE_PSU' }),
    ).toThrowError(BadRequestException);
    expect(client.creerAvenant).not.toHaveBeenCalled();
  });

  it('GET :id/versions et :id/versions/:versionId/impact relaient la lecture', async () => {
    const client = fakeClient();
    const controller = new ContratsController(client, fakeNotifications());

    const versions = await controller.listerVersions('c-1');
    expect(versions).toHaveLength(1);
    const impact = await controller.apercuImpact('c-1', 'v-1');
    expect(impact.moisCouverts).toEqual(['2026-06']);
    // Enrichissement additif : aucun mois communiqué par défaut (US-30-05).
    expect(impact.moisCommuniques).toEqual([]);
    expect(client.apercuImpactVersion).toHaveBeenCalledWith('c-1', 'v-1');
  });

  it('aperçu d’impact : croise les mois communiqués (US-30-05)', async () => {
    const client = fakeClient();
    // La crèche a déjà reçu le récap de juin (mois couvert) et de mai (hors impact).
    const notifs = fakeNotifications(['2026-05', '2026-06']);
    const controller = new ContratsController(client, notifs);

    const impact = await controller.apercuImpact('c-1', 'v-1');
    // Seuls les mois à la fois couverts ET communiqués remontent.
    expect(impact.moisCommuniques).toEqual(['2026-06']);
    expect(notifs.moisCommuniques).toHaveBeenCalledWith(
      'f-1',
      '2026-06',
      '2026-06',
    );
  });

  it('aperçu d’impact : notifications indisponibles → moisCommuniques vide (dégradé)', async () => {
    const client = fakeClient();
    const notifs = {
      moisCommuniques: vi.fn(async () => {
        throw new Error('svc-notifications KO');
      }),
    } as unknown as NotificationsClient;
    const controller = new ContratsController(client, notifs);

    const impact = await controller.apercuImpact('c-1', 'v-1');
    expect(impact.moisCommuniques).toEqual([]);
    expect(impact.moisCouverts).toEqual(['2026-06']);
  });

  it('PUT :id/versions/:versionId valide le mode puis relaie la correction', async () => {
    const client = fakeClient();
    const controller = new ContratsController(client, fakeNotifications());

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
    const controller = new ContratsController(client, fakeNotifications());

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
    const controller = new ContratsController(
      fakeClient(),
      fakeNotifications(),
    );
    expect(() => controller.lister(undefined)).toThrowError(
      BadRequestException,
    );
  });
});
