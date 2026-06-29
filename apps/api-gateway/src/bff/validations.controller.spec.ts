import { describe, expect, it, vi } from 'vitest';
import { BadRequestException } from '@nestjs/common';
import type { NotificationsClient } from '../clients/notifications.client.js';
import type {
  ContratVue,
  EtablissementVue,
  PlanificationClient,
} from '../clients/planification.client.js';
import { ValidationsController } from './validations.controller.js';

// Établissement **réel** (entité libre, `svc-planification`) : source du routage P3.
const ID_CRECHE = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const HIRONDELLES: EtablissementVue = {
  id: ID_CRECHE,
  foyerId: 'foyer-1',
  nom: 'Crèche des Hirondelles',
  emailService: 'creche@example.test',
  preavisRegle: { type: 'JOURS_OUVRES', valeur: 2 },
  types: ['CRECHE_PSU'],
  adresse: null,
  telephone: null,
  contact: null,
  actif: true,
};

const contrat = (
  p: Partial<ContratVue> & Pick<ContratVue, 'id' | 'mode'>,
): ContratVue => ({
  foyerId: 'foyer-1',
  enfant: 'Mia',
  etablissementId: null,
  valideDu: '2026-01-01',
  valideAu: null,
  ...p,
});

describe('ValidationsController · semaineBesoins', () => {
  it('refuse une semaine ISO mal formée (400, sans appel amont)', async () => {
    const planification = {
      listerContrats: vi.fn(),
      lirePlanning: vi.fn(),
    } as unknown as PlanificationClient;
    const notifications = {
      listerEtablissements: vi.fn(),
    } as unknown as NotificationsClient;
    const controller = new ValidationsController(notifications, planification);

    expect(() => controller.semaineBesoins('foyer-1', '2026-27')).toThrow(
      BadRequestException,
    );
    expect(planification.listerContrats).not.toHaveBeenCalled();
  });

  it('ne lit les plannings que des contrats actifs, sur les mois de la semaine', async () => {
    const actif = contrat({
      id: 'actif',
      mode: 'CRECHE_PSU',
      etablissementId: ID_CRECHE,
    });
    const inactif = contrat({
      id: 'inactif',
      mode: 'CANTINE',
      valideAu: '2026-05-31', // fini avant la semaine W27
    });
    const listerContrats = vi.fn().mockResolvedValue([actif, inactif]);
    const lirePlanning = vi
      .fn()
      .mockResolvedValue({ saisie: { absences: [{ date: '2026-06-29' }] } });
    // L'annuaire est désormais celui de svc-planification (établissements réels).
    const listerEtablissements = vi.fn().mockResolvedValue([HIRONDELLES]);
    const planification = {
      listerContrats,
      lirePlanning,
      listerEtablissements,
    } as unknown as PlanificationClient;
    const notifications = {} as unknown as NotificationsClient;
    const controller = new ValidationsController(notifications, planification);

    const vue = await controller.semaineBesoins('foyer-1', '2026-W27');

    // Un seul contrat actif → une vue à 1 contrat, routé vers l'établissement réel.
    expect(vue.contrats.map((c) => c.contratId)).toEqual(['actif']);
    expect(vue.contrats[0]?.etablissementId).toBe(ID_CRECHE);
    expect(vue.etablissements.map((e) => e.etablissementId)).toEqual([
      ID_CRECHE,
    ]);
    expect(listerEtablissements).toHaveBeenCalledWith('foyer-1');
    // W27 chevauche juin + juillet → 2 lectures, pour le seul contrat actif.
    expect(lirePlanning).toHaveBeenCalledTimes(2);
    expect(lirePlanning).toHaveBeenCalledWith('actif', '2026-06', false);
    expect(lirePlanning).toHaveBeenCalledWith('actif', '2026-07', false);
    expect(lirePlanning).not.toHaveBeenCalledWith(
      'inactif',
      expect.anything(),
      expect.anything(),
    );
  });

  it('propage une erreur amont en HttpException (relais)', async () => {
    const planification = {
      listerContrats: vi.fn().mockRejectedValue(new Error('HTTP 502')),
      lirePlanning: vi.fn(),
      listerEtablissements: vi.fn().mockResolvedValue([]),
    } as unknown as PlanificationClient;
    const notifications = {} as unknown as NotificationsClient;
    const controller = new ValidationsController(notifications, planification);

    await expect(
      controller.semaineBesoins('foyer-1', '2026-W27'),
    ).rejects.toMatchObject({ status: 502 });
  });
});

describe('ValidationsController · aValider', () => {
  const notif = (contratId: string) => ({
    contratId,
    foyerId: 'foyer-1',
    semaineIso: '2026-W28',
    statut: 'A_VALIDER' as const,
    notifieeLe: '2026-06-23T06:00:00.000Z',
  });

  it('refuse l’absence du paramètre foyer (400, sans appel amont)', () => {
    const listerAValider = vi.fn();
    const listerContrats = vi.fn();
    const controller = new ValidationsController(
      { listerAValider } as unknown as NotificationsClient,
      { listerContrats } as unknown as PlanificationClient,
    );

    expect(() => controller.aValider(undefined)).toThrow(BadRequestException);
    expect(listerAValider).not.toHaveBeenCalled();
    expect(listerContrats).not.toHaveBeenCalled();
  });

  it('enrichit chaque notification de l’enfant et du mode (jointure contrats)', async () => {
    const zoe = contrat({ id: 'c-zoe', enfant: 'Zoé', mode: 'CRECHE_PSU' });
    const mia = contrat({ id: 'c-mia', enfant: 'Mia', mode: 'CANTINE' });
    const listerAValider = vi
      .fn()
      .mockResolvedValue([notif('c-zoe'), notif('c-mia')]);
    const listerContrats = vi.fn().mockResolvedValue([zoe, mia]);
    const controller = new ValidationsController(
      { listerAValider } as unknown as NotificationsClient,
      { listerContrats } as unknown as PlanificationClient,
    );

    const vue = await controller.aValider('foyer-1');

    expect(listerContrats).toHaveBeenCalledWith('foyer-1');
    expect(vue).toEqual([
      { ...notif('c-zoe'), enfant: 'Zoé', mode: 'CRECHE_PSU' },
      { ...notif('c-mia'), enfant: 'Mia', mode: 'CANTINE' },
    ]);
  });

  it('relaie sans enrichir une notification dont le contrat n’est plus listé', async () => {
    const listerAValider = vi.fn().mockResolvedValue([notif('c-disparu')]);
    const listerContrats = vi.fn().mockResolvedValue([]);
    const controller = new ValidationsController(
      { listerAValider } as unknown as NotificationsClient,
      { listerContrats } as unknown as PlanificationClient,
    );

    const vue = await controller.aValider('foyer-1');

    expect(vue).toEqual([notif('c-disparu')]);
    expect(vue[0]).not.toHaveProperty('enfant');
  });

  it('propage une erreur amont en HttpException (relais)', async () => {
    const listerAValider = vi.fn().mockRejectedValue(new Error('HTTP 503'));
    const listerContrats = vi.fn().mockResolvedValue([]);
    const controller = new ValidationsController(
      { listerAValider } as unknown as NotificationsClient,
      { listerContrats } as unknown as PlanificationClient,
    );

    await expect(controller.aValider('foyer-1')).rejects.toMatchObject({
      status: 503,
    });
  });
});
