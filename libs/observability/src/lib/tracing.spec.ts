import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Démarrage du SDK OpenTelemetry. Le SDK réel est **mocké** : ce qu'on teste ici
 * n'est pas OTel mais les deux décisions du module, invisibles autrement et
 * coûteuses si elles cassent —
 *
 * 1. la **garde d'idempotence** (`if (sdk) return`) : un second appel ne doit pas
 *    enregistrer une seconde auto-instrumentation ni un second jeu de handlers de
 *    signal (fuite à chaque rechargement de module) ;
 * 2. l'**arrêt propre** sur SIGTERM/SIGINT : sans `shutdown()`, les spans et les
 *    métriques du dernier intervalle d'export sont perdus à chaque déploiement.
 *
 * Le module garde son état dans une variable de portée module : chaque test
 * repart d'un `vi.resetModules()` + import dynamique.
 */

const demarrer = vi.fn();
const arreter = vi.fn(() => Promise.resolve());

vi.mock('@opentelemetry/sdk-node', () => ({
  NodeSDK: class {
    start = demarrer;
    shutdown = arreter;
  },
}));
vi.mock('@opentelemetry/auto-instrumentations-node', () => ({
  getNodeAutoInstrumentations: vi.fn(() => []),
}));
vi.mock('@opentelemetry/exporter-trace-otlp-http', () => ({
  OTLPTraceExporter: class {},
}));
vi.mock('@opentelemetry/exporter-metrics-otlp-http', () => ({
  OTLPMetricExporter: class {},
}));
vi.mock('@opentelemetry/sdk-metrics', () => ({
  PeriodicExportingMetricReader: class {},
}));

async function chargerModule(): Promise<
  (typeof import('./tracing.js'))['startTracing']
> {
  vi.resetModules();
  const module = await import('./tracing.js');
  return module.startTracing;
}

describe('startTracing', () => {
  beforeEach(() => {
    demarrer.mockClear();
    arreter.mockClear();
  });

  afterEach(() => {
    process.removeAllListeners('SIGTERM');
    process.removeAllListeners('SIGINT');
    vi.restoreAllMocks();
  });

  it('démarre le SDK au premier appel', async () => {
    const startTracing = await chargerModule();

    startTracing('svc-foyer');

    expect(demarrer).toHaveBeenCalledOnce();
  });

  it('est idempotent : un second appel ne redémarre rien', async () => {
    const startTracing = await chargerModule();

    startTracing('svc-foyer');
    startTracing('svc-foyer');

    expect(demarrer).toHaveBeenCalledOnce();
  });

  it('arrête proprement le SDK sur SIGTERM avant de sortir', async () => {
    const startTracing = await chargerModule();
    const sortie = vi
      .spyOn(process, 'exit')
      .mockImplementation((() => undefined) as never);

    startTracing('svc-foyer');
    process.emit('SIGTERM');
    // `shutdown()` est asynchrone : on laisse la micro-tâche `finally` passer.
    await Promise.resolve();
    await Promise.resolve();

    expect(arreter).toHaveBeenCalledOnce();
    expect(sortie).toHaveBeenCalledWith(0);
  });

  it('arrête aussi le SDK sur SIGINT', async () => {
    const startTracing = await chargerModule();
    vi.spyOn(process, 'exit').mockImplementation((() => undefined) as never);

    startTracing('svc-foyer');
    process.emit('SIGINT');
    await Promise.resolve();

    expect(arreter).toHaveBeenCalledOnce();
  });
});
