import { describe, expect, it, vi } from 'vitest';
import { BadRequestException } from '@nestjs/common';
import type { Acteur } from '@creche-planner/nest-commons';
import { UnitesAssociativesController } from './unites-associatives.controller.js';
import { PortabiliteController } from '../portabilite/portabilite.controller.js';
import type {
  ExportUnitesAssociativesVue,
  PortabiliteService,
} from '../portabilite/portabilite.service.js';
import type {
  SessionUaVue,
  SuiviUaVue,
  UnitesAssociativesService,
} from './unites-associatives.service.js';
import {
  ZodValidationPipe,
  ajouterSessionSchema,
  declarerEngagementSchema,
  modifierSessionSchema,
} from './unites-associatives.dto.js';

const FOYER = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const ENGAGEMENT = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const SESSION = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const ACTEUR: Acteur = { type: 'parent', email: 'parent@example.test' };

const SUIVI = { foyerId: FOYER } as unknown as SuiviUaVue;
const SESSION_VUE = { id: SESSION, etat: 'PREVUE' } as unknown as SessionUaVue;

function controleur(
  service: Partial<UnitesAssociativesService>,
): UnitesAssociativesController {
  return new UnitesAssociativesController(service as UnitesAssociativesService);
}

describe('UnitesAssociativesController · garde du paramètre « foyer »', () => {
  it('exige un UUID et refuse une valeur absente', () => {
    expect(() => controleur({}).suivi(undefined)).toThrow(BadRequestException);
  });

  it('refuse une valeur qui n’est pas un UUID', () => {
    expect(() => controleur({}).suivi('pas-un-uuid')).toThrow(
      BadRequestException,
    );
  });

  /**
   * Express parse `?foyer[]=…` en TABLEAU, et `RegExp.test` stringifie son
   * argument : sans le `typeof === 'string'` posé AVANT la regex, un tableau
   * passerait la validation tout en restant un tableau en aval (CodeQL
   * `js/type-confusion-through-parameter-tampering`, même défaut que sur
   * `/couts`). Cette sonde-là est la seule à le prouver.
   */
  it('refuse un tableau déguisé en chaîne (confusion de type)', () => {
    expect(() => controleur({}).suivi([FOYER])).toThrow(BadRequestException);
  });

  it('accepte un UUID et délègue au service', async () => {
    const suivi = vi.fn().mockResolvedValue(SUIVI);
    await expect(controleur({ suivi }).suivi(FOYER)).resolves.toBe(SUIVI);
    expect(suivi).toHaveBeenCalledWith(FOYER);
  });
});

describe('UnitesAssociativesController · délégation', () => {
  const SAISIE_ENGAGEMENT = {
    debut: '2026-06-01',
    fin: '2027-05-31',
    quotaHeures: 20,
    valeurUaCentimes: 3125,
  };

  it('passe l’acteur au service à chaque mutation (piste d’audit, RM-40-08)', async () => {
    const declarerEngagement = vi.fn().mockResolvedValue({ id: ENGAGEMENT });
    const ajouterSession = vi.fn().mockResolvedValue(SESSION_VUE);
    const modifierSession = vi.fn().mockResolvedValue(SESSION_VUE);
    const supprimerSession = vi.fn().mockResolvedValue(undefined);
    const c = controleur({
      declarerEngagement,
      ajouterSession,
      modifierSession,
      supprimerSession,
    });

    await c.declarer(SAISIE_ENGAGEMENT, ACTEUR, FOYER);
    await c.ajouterSession(
      {
        engagementId: ENGAGEMENT,
        date: '2026-10-17',
        dureeHeures: 2,
        type: 'MENAGE',
      },
      ACTEUR,
      FOYER,
    );
    await c.modifierSession(SESSION, { etat: 'REALISEE' }, ACTEUR, FOYER);
    await c.supprimerSession(SESSION, ACTEUR, FOYER);

    expect(declarerEngagement).toHaveBeenCalledWith(
      FOYER,
      SAISIE_ENGAGEMENT,
      ACTEUR,
    );
    expect(ajouterSession).toHaveBeenCalledWith(
      FOYER,
      expect.any(Object),
      ACTEUR,
    );
    expect(modifierSession).toHaveBeenCalledWith(
      FOYER,
      SESSION,
      { etat: 'REALISEE' },
      ACTEUR,
    );
    expect(supprimerSession).toHaveBeenCalledWith(FOYER, SESSION, ACTEUR);
  });

  it('garde le foyer sur les routes de session aussi (pas seulement la lecture)', () => {
    const c = controleur({});
    expect(() => c.supprimerSession(SESSION, ACTEUR, 'pas-un-uuid')).toThrow(
      BadRequestException,
    );
  });
});

describe('Schémas de saisie (SFD 40)', () => {
  it('refuse une fin de période antérieure à son début', () => {
    const p = new ZodValidationPipe(declarerEngagementSchema);
    expect(() =>
      p.transform({
        debut: '2027-05-31',
        fin: '2026-06-01',
        quotaHeures: 20,
        valeurUaCentimes: 3125,
      }),
    ).toThrow(BadRequestException);
  });

  it('accepte l’engagement de référence de la doc 02 §4.5', () => {
    const p = new ZodValidationPipe(declarerEngagementSchema);
    expect(
      p.transform({
        debut: '2026-06-01',
        fin: '2027-05-31',
        quotaHeures: 20,
        valeurUaCentimes: 3125,
        cautionCentimes: 62500,
      }),
    ).toMatchObject({ quotaHeures: 20, valeurUaCentimes: 3125 });
  });

  it('refuse un type de créneau hors catalogue', () => {
    const p = new ZodValidationPipe(ajouterSessionSchema);
    expect(() =>
      p.transform({
        engagementId: ENGAGEMENT,
        date: '2026-10-17',
        dureeHeures: 2,
        type: 'JARDINAGE',
      }),
    ).toThrow(BadRequestException);
  });

  it('n’accepte pas d’état à la création : une session naît PREVUE', () => {
    const p = new ZodValidationPipe(ajouterSessionSchema);
    expect(
      p.transform({
        engagementId: ENGAGEMENT,
        date: '2026-10-17',
        dureeHeures: 2,
        type: 'MENAGE',
        etat: 'REALISEE',
      }),
    ).not.toHaveProperty('etat');
  });

  it('refuse une modification vide (aucun champ à changer)', () => {
    const p = new ZodValidationPipe(modifierSessionSchema);
    expect(() => p.transform({})).toThrow(BadRequestException);
  });

  it('nomme le champ fautif dans l’erreur de validation', () => {
    const p = new ZodValidationPipe(ajouterSessionSchema);
    try {
      p.transform({
        engagementId: ENGAGEMENT,
        date: '2026-10-17',
        dureeHeures: -1,
        type: 'MENAGE',
      });
      expect.unreachable('la validation aurait dû refuser');
    } catch (erreur) {
      expect(JSON.stringify(erreur)).toContain('dureeHeures');
    }
  });
});

describe('PortabiliteController · part UA de l’export (doc 37 §6)', () => {
  it('délègue au service et rend le document tel quel', async () => {
    const document = {
      foyerId: FOYER,
      engagements: [],
      pisteAudit: [],
    } as unknown as ExportUnitesAssociativesVue;
    const exporter = vi.fn().mockResolvedValue(document);
    const controller = new PortabiliteController({
      exporter,
    } as unknown as PortabiliteService);

    await expect(controller.exporter(FOYER)).resolves.toBe(document);
    expect(exporter).toHaveBeenCalledWith(FOYER);
  });
});
