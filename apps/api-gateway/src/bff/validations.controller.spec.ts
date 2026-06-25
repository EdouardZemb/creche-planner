import { describe, expect, it, vi } from 'vitest';
import { BadRequestException } from '@nestjs/common';
import type { ContratVue } from '../clients/planification.client.js';
import type {
  EtablissementVue,
  NotificationsClient,
} from '../clients/notifications.client.js';
import type { PlanificationClient } from '../clients/planification.client.js';
import { ValidationsController } from './validations.controller.js';

const HIRONDELLES: EtablissementVue = {
  cle: 'CRECHE_HIRONDELLES',
  libelle: 'Crèche des Hirondelles',
  emailService: 'creche@example.test',
  preavisRegle: { type: 'JOURS_OUVRES', valeur: 2 },
  actif: true,
};

const contrat = (
  p: Partial<ContratVue> & Pick<ContratVue, 'id' | 'mode'>,
): ContratVue => ({
  foyerId: 'foyer-1',
  enfant: 'Mia',
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
    const actif = contrat({ id: 'actif', mode: 'CRECHE_PSU' });
    const inactif = contrat({
      id: 'inactif',
      mode: 'CANTINE',
      valideAu: '2026-05-31', // fini avant la semaine W27
    });
    const listerContrats = vi.fn().mockResolvedValue([actif, inactif]);
    const lirePlanning = vi
      .fn()
      .mockResolvedValue({ saisie: { absences: [{ date: '2026-06-29' }] } });
    const planification = {
      listerContrats,
      lirePlanning,
    } as unknown as PlanificationClient;
    const notifications = {
      listerEtablissements: vi.fn().mockResolvedValue([HIRONDELLES]),
    } as unknown as NotificationsClient;
    const controller = new ValidationsController(notifications, planification);

    const vue = await controller.semaineBesoins('foyer-1', '2026-W27');

    // Un seul contrat actif → une vue à 1 contrat.
    expect(vue.contrats.map((c) => c.contratId)).toEqual(['actif']);
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
    } as unknown as PlanificationClient;
    const notifications = {
      listerEtablissements: vi.fn().mockResolvedValue([]),
    } as unknown as NotificationsClient;
    const controller = new ValidationsController(notifications, planification);

    await expect(
      controller.semaineBesoins('foyer-1', '2026-W27'),
    ).rejects.toMatchObject({ status: 502 });
  });
});
