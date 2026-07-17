import {
  type ExecutionContext,
  ForbiddenException,
  Logger,
} from '@nestjs/common';
import { type Reflector } from '@nestjs/core';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { type FoyerClient } from '../clients/foyer.client.js';
import { type PlanificationClient } from '../clients/planification.client.js';
import { AppartenanceGuard } from './appartenance.guard.js';
import { type SourceFoyer } from './foyer-scope.js';
import { type RequeteIdentifiable } from './identite.js';

/**
 * Lot 2 (fondations, métriques) : chaque refus incrémente le compteur Prometheus
 * `gateway_authz_refus_total{decision, motif}`. On isole le compteur en mockant
 * l'API OTel `@opentelemetry/api` (dépendance directe de l'api-gateway) pour vérifier
 * l'incrément et ses labels sans câbler de MeterProvider. `vi.hoisted` expose le mock
 * `add` au factory `vi.mock` (hissé au-dessus des imports).
 */
const { addRefus } = vi.hoisted(() => ({ addRefus: vi.fn() }));

vi.mock('@opentelemetry/api', () => ({
  metrics: {
    getMeter: () => ({ createCounter: () => ({ add: addRefus }) }),
  },
}));

/** Faux Reflector renvoyant la source `@FoyerScope` (ou `undefined`). */
function fakeReflector(source: SourceFoyer | undefined): Reflector {
  return { getAllAndOverride: () => source } as unknown as Reflector;
}

/** Faux FoyerClient n'exposant que la résolution `foyersParEmail`. */
function fakeFoyers(
  foyersParEmail: (email: string) => Promise<string[]>,
): FoyerClient {
  return { foyersParEmail: vi.fn(foyersParEmail) } as unknown as FoyerClient;
}

/** Faux PlanificationClient n'exposant que la résolution `contrat`. */
function fakePlanification(
  contrat: (id: string) => Promise<{ foyerId: string }>,
): PlanificationClient {
  return { contrat: vi.fn(contrat) } as unknown as PlanificationClient;
}

function fakeContext(req: RequeteIdentifiable): ExecutionContext {
  return {
    switchToHttp: () => ({ getRequest: () => req }),
    getHandler: () => () => undefined,
    getClass: () => class {},
  } as unknown as ExecutionContext;
}

function requete(p: Partial<RequeteIdentifiable> = {}): RequeteIdentifiable {
  return { headers: {}, ...p };
}

describe('AppartenanceGuard (PR7, autorisation par foyer)', () => {
  let envInitial: NodeJS.ProcessEnv;

  beforeEach(() => {
    envInitial = { ...process.env };
    delete process.env['ADMIN_EMAILS'];
    delete process.env['FOYER_AUTHZ_ENFORCE'];
    addRefus.mockClear();
  });

  afterEach(() => {
    process.env = envInitial;
    vi.restoreAllMocks();
  });

  it('route non scopée (@FoyerScope absent) → laisse passer sans résoudre', async () => {
    const foyers = fakeFoyers(async () => ['f-1']);
    const guard = new AppartenanceGuard(
      fakeReflector(undefined),
      foyers,
      fakePlanification(async () => ({ foyerId: 'f-1' })),
    );
    const req = requete({
      identite: { email: 'p@test.fr' },
      query: { foyer: 'f-1' },
    });
    await expect(guard.canActivate(fakeContext(req))).resolves.toBe(true);
    expect(foyers.foyersParEmail).not.toHaveBeenCalled();
  });

  it('aucune identité établie → laisse passer sans appeler svc-foyer', async () => {
    const foyers = fakeFoyers(async () => ['f-1']);
    const guard = new AppartenanceGuard(
      fakeReflector('query:foyer'),
      foyers,
      fakePlanification(async () => ({ foyerId: 'f-1' })),
    );
    const req = requete({ query: { foyer: 'f-1' } });
    await expect(guard.canActivate(fakeContext(req))).resolves.toBe(true);
    expect(foyers.foyersParEmail).not.toHaveBeenCalled();
  });

  it('admin (∈ ADMIN_EMAILS) → bypass, ne résout pas l’appartenance', async () => {
    process.env['ADMIN_EMAILS'] = 'admin@test.fr';
    process.env['FOYER_AUTHZ_ENFORCE'] = '1';
    const foyers = fakeFoyers(async () => []);
    const guard = new AppartenanceGuard(
      fakeReflector('param:id'),
      foyers,
      fakePlanification(async () => ({ foyerId: 'x' })),
    );
    const req = requete({
      identite: { email: 'Admin@Test.fr' },
      params: { id: 'f-autre' },
    });
    await expect(guard.canActivate(fakeContext(req))).resolves.toBe(true);
    expect(foyers.foyersParEmail).not.toHaveBeenCalled();
  });

  it('foyerId introuvable dans la requête → journalise et laisse passer', async () => {
    const warn = vi.spyOn(Logger.prototype, 'warn');
    const foyers = fakeFoyers(async () => ['f-1']);
    const guard = new AppartenanceGuard(
      fakeReflector('query:foyer'),
      foyers,
      fakePlanification(async () => ({ foyerId: 'f-1' })),
    );
    const req = requete({ identite: { email: 'p@test.fr' } });
    await expect(guard.canActivate(fakeContext(req))).resolves.toBe(true);
    expect(foyers.foyersParEmail).not.toHaveBeenCalled();
    expect(warn).toHaveBeenCalledOnce();
  });

  describe('observe-only (flag FOYER_AUTHZ_ENFORCE absent)', () => {
    it('foyer autorisé → laisse passer (aucun warn)', async () => {
      const warn = vi.spyOn(Logger.prototype, 'warn');
      const guard = new AppartenanceGuard(
        fakeReflector('query:foyer'),
        fakeFoyers(async () => ['f-1', 'f-2']),
        fakePlanification(async () => ({ foyerId: 'f-1' })),
      );
      const req = requete({
        identite: { email: 'p@test.fr' },
        query: { foyer: 'f-1' },
      });
      await expect(guard.canActivate(fakeContext(req))).resolves.toBe(true);
      expect(warn).not.toHaveBeenCalled();
      expect(addRefus).not.toHaveBeenCalled();
    });

    it('foyer NON autorisé → journalise « AURAIT REFUSÉ » mais laisse passer', async () => {
      const warn = vi.spyOn(Logger.prototype, 'warn');
      const guard = new AppartenanceGuard(
        fakeReflector('param:id'),
        fakeFoyers(async () => ['f-2']),
        fakePlanification(async () => ({ foyerId: 'x' })),
      );
      const req = requete({
        identite: { email: 'intrus@test.fr' },
        params: { id: 'f-1' },
      });
      await expect(guard.canActivate(fakeContext(req))).resolves.toBe(true);
      expect(warn).toHaveBeenCalledOnce();
      expect(warn.mock.calls[0]?.[0]).toMatch(/AURAIT REFUSÉ.*f-1/);
      // Métrique : refus « observe » hors scope.
      expect(addRefus).toHaveBeenCalledWith(1, {
        decision: 'aurait_refuse',
        motif: 'hors_scope',
      });
    });

    it('résolution svc-foyer en échec → journalise, ne lève pas', async () => {
      const warn = vi.spyOn(Logger.prototype, 'warn');
      const guard = new AppartenanceGuard(
        fakeReflector('query:foyer'),
        fakeFoyers(async () => {
          throw new Error('svc-foyer indisponible');
        }),
        fakePlanification(async () => ({ foyerId: 'f-1' })),
      );
      const req = requete({
        identite: { email: 'p@test.fr' },
        query: { foyer: 'f-1' },
      });
      await expect(guard.canActivate(fakeContext(req))).resolves.toBe(true);
      expect(warn).toHaveBeenCalledOnce();
      // Métrique : refus « observe » sur résolution impossible.
      expect(addRefus).toHaveBeenCalledWith(1, {
        decision: 'aurait_refuse',
        motif: 'resolution_impossible',
      });
    });
  });

  describe('enforce (flag FOYER_AUTHZ_ENFORCE=1)', () => {
    beforeEach(() => {
      process.env['FOYER_AUTHZ_ENFORCE'] = '1';
    });

    it('foyer autorisé → laisse passer', async () => {
      const guard = new AppartenanceGuard(
        fakeReflector('query:foyer'),
        fakeFoyers(async () => ['f-1']),
        fakePlanification(async () => ({ foyerId: 'f-1' })),
      );
      const req = requete({
        identite: { email: 'p@test.fr' },
        query: { foyer: 'f-1' },
      });
      await expect(guard.canActivate(fakeContext(req))).resolves.toBe(true);
    });

    it('foyer NON autorisé → 403 (ForbiddenException)', async () => {
      const guard = new AppartenanceGuard(
        fakeReflector('param:id'),
        fakeFoyers(async () => ['f-2']),
        fakePlanification(async () => ({ foyerId: 'x' })),
      );
      const req = requete({
        identite: { email: 'intrus@test.fr' },
        params: { id: 'f-1' },
      });
      await expect(guard.canActivate(fakeContext(req))).rejects.toThrow(
        ForbiddenException,
      );
      // Métrique : refus réel (403) hors scope.
      expect(addRefus).toHaveBeenCalledWith(1, {
        decision: 'refuse',
        motif: 'hors_scope',
      });
    });

    it('résolution impossible (svc-foyer KO) → fail-closed 403', async () => {
      const guard = new AppartenanceGuard(
        fakeReflector('query:foyer'),
        fakeFoyers(async () => {
          throw new Error('svc-foyer indisponible');
        }),
        fakePlanification(async () => ({ foyerId: 'f-1' })),
      );
      const req = requete({
        identite: { email: 'p@test.fr' },
        query: { foyer: 'f-1' },
      });
      await expect(guard.canActivate(fakeContext(req))).rejects.toThrow(
        ForbiddenException,
      );
      // Métrique : refus réel (403) sur résolution impossible (fail-closed).
      expect(addRefus).toHaveBeenCalledWith(1, {
        decision: 'refuse',
        motif: 'resolution_impossible',
      });
    });

    it('contrat:id → résout contrat→foyer ; foyer autorisé → passe', async () => {
      const planification = fakePlanification(async () => ({ foyerId: 'f-1' }));
      const guard = new AppartenanceGuard(
        fakeReflector('contrat:id'),
        fakeFoyers(async () => ['f-1']),
        planification,
      );
      const req = requete({
        identite: { email: 'p@test.fr' },
        params: { id: 'c-9' },
      });
      await expect(guard.canActivate(fakeContext(req))).resolves.toBe(true);
      expect(planification.contrat).toHaveBeenCalledWith('c-9');
    });

    it('contrat:id → foyer du contrat NON autorisé → 403', async () => {
      const guard = new AppartenanceGuard(
        fakeReflector('contrat:id'),
        fakeFoyers(async () => ['f-2']),
        fakePlanification(async () => ({ foyerId: 'f-1' })),
      );
      const req = requete({
        identite: { email: 'intrus@test.fr' },
        params: { id: 'c-9' },
      });
      await expect(guard.canActivate(fakeContext(req))).rejects.toThrow(
        ForbiddenException,
      );
    });

    it('contrat introuvable (résolution KO) → fail-closed 403', async () => {
      const guard = new AppartenanceGuard(
        fakeReflector('contrat:id'),
        fakeFoyers(async () => ['f-1']),
        fakePlanification(async () => {
          throw new Error('HTTP 404');
        }),
      );
      const req = requete({
        identite: { email: 'p@test.fr' },
        params: { id: 'c-inconnu' },
      });
      await expect(guard.canActivate(fakeContext(req))).rejects.toThrow(
        ForbiddenException,
      );
    });
  });
});
