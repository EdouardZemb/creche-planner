import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../config.js', () => ({
  loadConfig: () => ({
    referentielUrl: 'http://svc-referentiel:3001',
    foyerUrl: 'http://svc-foyer:3002',
    planificationUrl: 'http://svc-planification:3004',
    tarificationUrl: 'http://svc-tarification:3005',
    notificationsUrl: 'http://svc-notifications:3006',
  }),
}));

import type {
  HealthCheckService,
  HealthIndicatorResult,
  HealthIndicatorService,
} from '@nestjs/terminus';
import { AmontsHealthIndicator } from './amonts.health.js';
import { HealthController } from './health.controller.js';

/**
 * Readiness de la **chaîne** gateway (lot B3). Quatre propriétés valent d'être
 * verrouillées ici, parce qu'une régression sur l'une ou l'autre est silencieuse :
 *
 * - **la sonde vise la readiness des amonts** (`/api/health`) et non leur liveness :
 *   c'est la readiness qui couvre base + migrations + NATS, donc la seule qui
 *   distingue « le process répond » de « le service accepte du trafic » — cause
 *   racine des 502/503 du seed ;
 * - **liveness ≠ readiness côté gateway** : `/api/health/live` ne sonde toujours
 *   RIEN (healthchecks compose + blackbox pointent dessus — y accrocher un amont
 *   déclencherait des restarts en cascade, contrainte des lots A6/A7) ;
 * - **un amont est rapporté nominativement** : le diagnostic doit tomber du corps
 *   de la réponse, pas d'une inspection service par service ;
 * - **le lot est mis en cache** : la readiness est relue en boucle (Porte 3, smoke
 *   CI, heartbeat) — une sonde par requête multiplierait le trafic interne par 5.
 */

const AMONTS = [
  'svc-referentiel',
  'svc-foyer',
  'svc-planification',
  'svc-tarification',
  'svc-notifications',
] as const;

interface Rapport {
  readonly cle: string;
  readonly statut: 'up' | 'down';
  readonly detail?: Record<string, unknown> | undefined;
}

/** Terminus mocké : on garde la trace de ce que chaque sonde a rapporté. */
function fakeTerminus(): {
  service: HealthIndicatorService;
  rapports: Rapport[];
} {
  const rapports: Rapport[] = [];
  const service = {
    check: (cle: string) => ({
      up: () => {
        rapports.push({ cle, statut: 'up' });
        return { [cle]: { status: 'up' } };
      },
      down: (detail?: Record<string, unknown>) => {
        rapports.push({ cle, statut: 'down', detail });
        return { [cle]: { status: 'down', ...detail } };
      },
    }),
  } as unknown as HealthIndicatorService;
  return { service, rapports };
}

/** Réponse HTTP minimale — seul `ok`/`status` intéresse une sonde de santé. */
function reponse(status: number): Response {
  return { ok: status >= 200 && status < 300, status } as unknown as Response;
}

/** Remplace `fetch` par une réponse fonction de l'URL sondée. */
function stubFetch(
  repondre: (url: string) => Promise<Response>,
): ReturnType<typeof vi.fn<(url: string) => Promise<Response>>> {
  const fetchMock = vi.fn(repondre);
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

/** Joue toutes les sondes comme terminus le ferait : en parallèle. */
async function jouerSondes(indicateur: AmontsHealthIndicator): Promise<void> {
  await Promise.all(indicateur.sondes().map((sonde) => sonde()));
}

describe('AmontsHealthIndicator', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('rapporte les 5 amonts up quand tous répondent 2xx', async () => {
    stubFetch(() => Promise.resolve(reponse(200)));
    const { service, rapports } = fakeTerminus();

    await jouerSondes(new AmontsHealthIndicator(service));

    expect(rapports.map((r) => r.cle).sort()).toEqual([...AMONTS].sort());
    expect(rapports.every((r) => r.statut === 'up')).toBe(true);
  });

  it('sonde la READINESS des amonts (/api/health), pas leur liveness', async () => {
    const fetchMock = stubFetch(() => Promise.resolve(reponse(200)));

    await jouerSondes(new AmontsHealthIndicator(fakeTerminus().service));

    expect(fetchMock.mock.calls.map((appel) => appel[0])).toEqual([
      'http://svc-referentiel:3001/api/health',
      'http://svc-foyer:3002/api/health',
      'http://svc-planification:3004/api/health',
      'http://svc-tarification:3005/api/health',
      'http://svc-notifications:3006/api/health',
    ]);
  });

  it('nomme l’amont fautif et son statut HTTP quand il n’est pas prêt', async () => {
    stubFetch((url) =>
      Promise.resolve(reponse(url.includes('svc-foyer') ? 503 : 200)),
    );
    const { service, rapports } = fakeTerminus();

    await jouerSondes(new AmontsHealthIndicator(service));

    expect(rapports.filter((r) => r.statut === 'down')).toEqual([
      { cle: 'svc-foyer', statut: 'down', detail: { httpStatus: 503 } },
    ]);
  });

  it('nomme la cause quand un amont est injoignable', async () => {
    stubFetch((url) =>
      url.includes('svc-tarification')
        ? Promise.reject(new Error('ECONNREFUSED'))
        : Promise.resolve(reponse(200)),
    );
    const { service, rapports } = fakeTerminus();

    await jouerSondes(new AmontsHealthIndicator(service));

    expect(rapports.filter((r) => r.statut === 'down')).toEqual([
      {
        cle: 'svc-tarification',
        statut: 'down',
        detail: { message: 'ECONNREFUSED' },
      },
    ]);
  });

  it('ne sonde les amonts qu’une fois par lot, même relu en boucle', async () => {
    const fetchMock = stubFetch(() => Promise.resolve(reponse(200)));
    const indicateur = new AmontsHealthIndicator(fakeTerminus().service);

    await jouerSondes(indicateur);
    await jouerSondes(indicateur);

    expect(fetchMock).toHaveBeenCalledTimes(AMONTS.length);
  });

  it('re-sonde une fois le lot périmé (aucun verdict figé)', async () => {
    const fetchMock = stubFetch(() => Promise.resolve(reponse(200)));
    const indicateur = new AmontsHealthIndicator(fakeTerminus().service);

    await jouerSondes(indicateur);
    vi.advanceTimersByTime(5_000);
    await jouerSondes(indicateur);

    expect(fetchMock).toHaveBeenCalledTimes(2 * AMONTS.length);
  });
});

describe('HealthController (gateway)', () => {
  function controleur(sondes: (() => Promise<HealthIndicatorResult>)[] = []): {
    ctrl: HealthController;
    check: ReturnType<typeof vi.fn>;
  } {
    const check = vi.fn(() => Promise.resolve({ status: 'ok' }));
    const ctrl = new HealthController(
      { check } as unknown as HealthCheckService,
      { sondes: () => sondes } as unknown as AmontsHealthIndicator,
    );
    return { ctrl, check };
  }

  it('la readiness sonde tous les amonts de l’indicateur', async () => {
    const sondes = [
      vi.fn(),
      vi.fn(),
      vi.fn(),
    ] as unknown as (() => Promise<HealthIndicatorResult>)[];
    const { ctrl, check } = controleur(sondes);

    await ctrl.readiness();

    expect(check).toHaveBeenCalledWith(sondes);
  });

  it('la liveness ne sonde AUCUNE dépendance (sinon restarts en cascade)', async () => {
    const { ctrl, check } = controleur();

    await ctrl.liveness();

    expect(check).toHaveBeenCalledWith([]);
  });
});
