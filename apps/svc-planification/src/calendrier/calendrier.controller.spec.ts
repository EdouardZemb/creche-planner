import 'reflect-metadata';
import { describe, expect, it, vi } from 'vitest';
import { HTTP_CODE_METADATA } from '@nestjs/common/constants';
import { SCOPE_FOYER_KEY } from '@creche-planner/nest-commons';
import { CalendrierController } from './calendrier.controller.js';
import type { CalendrierImportService } from './calendrier-import.service.js';
import type { CalendrierService } from './calendrier.service.js';

/**
 * Le contrôleur ne décide de rien : il valide et délègue. Ce que ces tests
 * prouvent tient donc en deux points, et ce sont les deux qui coûteraient cher
 * s'ils étaient faux :
 *
 * 1. **Le passage de `aLaDate`.** Le paramètre traverse quatre couches et chacune
 *    peut le perdre **sans erreur** (`LE-48`). Ici on vérifie qu'il arrive au
 *    service, plutôt que de le supposer.
 * 2. **Le scoping.** Chaque route porte `@ScopeFoyerInterServices` dès le premier
 *    commit — pas d'observe-only qui casserait à la bascule
 *    `INTERSERVICE_AUTHZ_ENFORCE=1` (§4 du plan). Un oubli sur UNE route
 *    ouvrirait le calendrier d'un autre foyer.
 */

const ETAB = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const INSTANT = '2026-05-01T00:00:00.000Z';

function faux(): {
  controleur: CalendrierController;
  service: Record<string, ReturnType<typeof vi.fn>>;
  imports: Record<string, ReturnType<typeof vi.fn>>;
} {
  const service = {
    lireResolu: vi.fn().mockResolvedValue({ jours: [] }),
    lireRecurrences: vi.fn().mockResolvedValue({ recurrences: [] }),
    remplacerRecurrences: vi.fn().mockResolvedValue({ recurrences: [] }),
    lirePeriodes: vi.fn().mockResolvedValue({ periodes: [] }),
    saisirPeriode: vi.fn().mockResolvedValue({ id: 'p' }),
    retoucherPeriode: vi.fn().mockResolvedValue({ id: 'p' }),
    clorePeriode: vi.fn().mockResolvedValue(undefined),
    lireExceptions: vi.fn().mockResolvedValue({ exceptions: [] }),
    poserException: vi.fn().mockResolvedValue({ id: 'e' }),
    cloreException: vi.fn().mockResolvedValue(undefined),
  };
  // Le service d'import (lot 3) est un collaborateur distinct : le contrôleur
  // ne fait que lui passer l'année, et c'est ce passage-là qu'on veut voir.
  const imports = {
    importerAnnee: vi.fn().mockResolvedValue({
      anneeScolaire: '2026-2027',
      zoneScolaire: 'B',
      importees: 5,
      remplacees: 0,
    }),
  };
  return {
    controleur: new CalendrierController(
      service as unknown as CalendrierService,
      imports as unknown as CalendrierImportService,
    ),
    service,
    imports,
  };
}

describe('CalendrierController — `aLaDate` arrive jusqu’au service', () => {
  it('transmet la plage ET l’instant de connaissance', async () => {
    const { controleur, service } = faux();
    await controleur.lire(ETAB, {
      du: '2026-03-02',
      au: '2026-03-31',
      aLaDate: INSTANT,
    });
    expect(service['lireResolu']).toHaveBeenCalledWith(
      ETAB,
      '2026-03-02',
      '2026-03-31',
      INSTANT,
    );
  });

  it('transmet `undefined` quand l’instant est omis (le service tranche le défaut)', async () => {
    const { controleur, service } = faux();
    await controleur.lire(ETAB, { du: '2026-03-02', au: '2026-03-31' });
    expect(service['lireResolu']).toHaveBeenCalledWith(
      ETAB,
      '2026-03-02',
      '2026-03-31',
      undefined,
    );
  });

  it('transmet l’instant aux trois couches brutes', async () => {
    const { controleur, service } = faux();
    await controleur.lireRecurrences(ETAB, { aLaDate: INSTANT });
    await controleur.lirePeriodes(ETAB, { aLaDate: INSTANT });
    await controleur.lireExceptions(ETAB, { aLaDate: INSTANT });
    expect(service['lireRecurrences']).toHaveBeenCalledWith(ETAB, INSTANT);
    expect(service['lirePeriodes']).toHaveBeenCalledWith(ETAB, INSTANT);
    expect(service['lireExceptions']).toHaveBeenCalledWith(ETAB, INSTANT);
  });
});

describe('CalendrierController — délégation des écritures', () => {
  it('délègue le remplacement de la semaine type', async () => {
    const { controleur, service } = faux();
    const dto = { recurrences: [] };
    await controleur.remplacerRecurrences(ETAB, dto);
    expect(service['remplacerRecurrences']).toHaveBeenCalledWith(ETAB, dto);
  });

  it('délègue la saisie et la retouche d’une période', async () => {
    const { controleur, service } = faux();
    const dto = {
      type: 'VACANCES' as const,
      libelle: 'Printemps',
      du: '2026-04-04',
      au: '2026-04-20',
    };
    await controleur.saisirPeriode(ETAB, dto);
    await controleur.retoucherPeriode(ETAB, 'p1', dto);
    expect(service['saisirPeriode']).toHaveBeenCalledWith(ETAB, dto);
    expect(service['retoucherPeriode']).toHaveBeenCalledWith(ETAB, 'p1', dto);
  });

  it('délègue la pose d’exception et les deux clôtures', async () => {
    const { controleur, service } = faux();
    await controleur.poserException(ETAB, {
      jour: '2026-03-03',
      type: 'FERMETURE',
      libelle: 'Fermeture',
    });
    await controleur.clorePeriode(ETAB, 'p1');
    await controleur.cloreException(ETAB, 'e1');
    expect(service['poserException']).toHaveBeenCalledOnce();
    expect(service['clorePeriode']).toHaveBeenCalledWith(ETAB, 'p1');
    expect(service['cloreException']).toHaveBeenCalledWith(ETAB, 'e1');
  });
});

describe('CalendrierController — métadonnées de route', () => {
  /**
   * Toutes les méthodes de route du contrôleur, lues sur le prototype plutôt
   * qu'énumérées à la main : une route ajoutée demain entre **automatiquement**
   * dans le périmètre de la garde ci-dessous. Une liste écrite en dur ne dirait
   * rien de la route qu'on aurait oublié d'y ajouter — exactement le mode de
   * défaillance que ce dépôt paie le plus cher.
   */
  const methodes = Object.getOwnPropertyNames(
    CalendrierController.prototype,
  ).filter((nom) => nom !== 'constructor');

  it('voit bien les onze routes du contrôleur (sonde de la sonde)', () => {
    expect(methodes).toHaveLength(11);
  });

  it('porte le scoping foyer sur CHAQUE route, dès le premier commit', () => {
    const sansScope = methodes.filter((nom) => {
      const handler = (
        CalendrierController.prototype as unknown as Record<string, unknown>
      )[nom];
      return (
        Reflect.getMetadata(SCOPE_FOYER_KEY, handler as object) === undefined
      );
    });
    expect(sansScope).toEqual([]);
  });

  it('rend 204 sur les clôtures et 201 sur les créations', () => {
    const code = (nom: string): unknown =>
      Reflect.getMetadata(
        HTTP_CODE_METADATA,
        (CalendrierController.prototype as unknown as Record<string, unknown>)[
          nom
        ] as object,
      );
    expect(code('clorePeriode')).toBe(204);
    expect(code('cloreException')).toBe(204);
    expect(code('saisirPeriode')).toBe(201);
    expect(code('poserException')).toBe(201);
  });
});

describe('CalendrierController — import d’une année (lot 3)', () => {
  it('passe l’année au service d’import, et rien d’autre', async () => {
    const { controleur, imports } = faux();
    const resultat = await controleur.importerAnnee(ETAB, {
      anneeScolaire: '2026-2027',
    });
    // La ZONE n'est pas un paramètre de la route : elle vient de
    // l'établissement. Si elle apparaissait ici, un import « zone A » sur un
    // établissement de zone B deviendrait possible.
    expect(imports['importerAnnee']).toHaveBeenCalledWith(ETAB, '2026-2027');
    expect(resultat.importees).toBe(5);
  });
});
