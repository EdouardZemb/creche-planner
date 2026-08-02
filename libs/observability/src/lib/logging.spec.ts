import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { buildLoggerParams } from './logging.js';

/**
 * Options du logger pino partagées par les six services. Elles sont pilotées par
 * l'environnement, donc invisibles à la compilation : c'est exactement le genre
 * de code où une régression ne se voit qu'en prod (logs muets, `reqId` vide,
 * pino-pretty embarqué par erreur dans une image de production).
 */

/** Requête minimale acceptée par `genReqId` (le reste de `req` est inutilisé). */
interface RequeteMinimale {
  readonly headers: Record<string, string>;
}

/** Accès typé au `genReqId` construit (toujours défini par `buildLoggerParams`). */
function genReqId(
  params: ReturnType<typeof buildLoggerParams>,
): (req: RequeteMinimale) => string {
  return (params.pinoHttp as { genReqId: (req: RequeteMinimale) => string })
    .genReqId;
}

/** Accès typé aux options pino construites. */
function options(params: ReturnType<typeof buildLoggerParams>): {
  name: string;
  level: string;
  autoLogging: boolean;
  transport?: { target: string };
} {
  return params.pinoHttp as {
    name: string;
    level: string;
    autoLogging: boolean;
    transport?: { target: string };
  };
}

describe('buildLoggerParams', () => {
  let envInitial: NodeJS.ProcessEnv;

  beforeEach(() => {
    envInitial = { ...process.env };
    delete process.env['LOG_LEVEL'];
    delete process.env['LOG_PRETTY'];
  });

  afterEach(() => {
    process.env = envInitial;
  });

  it('nomme le logger d’après le service et journalise en `info` par défaut', () => {
    const opts = options(buildLoggerParams('svc-foyer'));

    expect(opts.name).toBe('svc-foyer');
    expect(opts.level).toBe('info');
    expect(opts.autoLogging).toBe(true);
  });

  it('respecte `LOG_LEVEL`', () => {
    process.env['LOG_LEVEL'] = 'debug';

    expect(options(buildLoggerParams('svc-foyer')).level).toBe('debug');
  });

  it('n’embarque PAS pino-pretty par défaut (sortie JSON structurée)', () => {
    expect(options(buildLoggerParams('svc-foyer')).transport).toBeUndefined();
  });

  it('active pino-pretty sur `LOG_PRETTY=true` seulement', () => {
    process.env['LOG_PRETTY'] = 'true';
    expect(options(buildLoggerParams('svc-foyer')).transport?.target).toBe(
      'pino-pretty',
    );

    process.env['LOG_PRETTY'] = '1';
    expect(options(buildLoggerParams('svc-foyer')).transport).toBeUndefined();
  });

  describe('genReqId — identifiant de corrélation', () => {
    it('préfère `x-request-id` au `traceparent`', () => {
      const id = genReqId(buildLoggerParams('svc-foyer'))({
        headers: { 'x-request-id': 'req-1', traceparent: 'tp-1' },
      });

      expect(id).toBe('req-1');
    });

    it('retombe sur `traceparent` en l’absence de `x-request-id`', () => {
      const id = genReqId(buildLoggerParams('svc-foyer'))({
        headers: { traceparent: 'tp-1' },
      });

      expect(id).toBe('tp-1');
    });

    it('renvoie une chaîne vide quand aucun en-tête de corrélation n’est fourni', () => {
      expect(genReqId(buildLoggerParams('svc-foyer'))({ headers: {} })).toBe(
        '',
      );
    });
  });
});
