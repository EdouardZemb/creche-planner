import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import type { Clock } from '../common/clock.js';
import type { OptionsPurge, TachePurge } from './purge.options.js';
import { PurgeService } from './purge.service.js';

/**
 * Les deux compteurs OTel sont typés : sans cela `mock.calls` est `any[]`, et lire
 * l'attribut `tache` d'un appel devient un retour non sûr que le lint refuse.
 */
type Compteur = (valeur: number, attributs: { tache: string }) => void;

const { addLignes, addEchecs } = vi.hoisted(() => ({
  addLignes: vi.fn<Compteur>(),
  addEchecs: vi.fn<Compteur>(),
}));

vi.mock('@opentelemetry/api', () => ({
  metrics: {
    getMeter: () => ({
      createCounter: (nom: string) => ({
        add: nom === 'purge_lignes_total' ? addLignes : addEchecs,
      }),
    }),
  },
}));

const MAINTENANT = new Date('2026-08-12T10:00:00.000Z');

/** Horloge figée : tout le raisonnement temporel du service passe par ce port. */
const horloge: Clock = { maintenant: () => MAINTENANT };

/** Base factice — le service ne l'utilise que pour construire les tâches mutualisées. */
const db = {} as unknown as PostgresJsDatabase;

/** Tâche espionne : enregistre la borne reçue, rend un nombre de lignes fixé. */
function tache(
  nom: string,
  retentionJours: number,
  resultat: number | Error = 1,
): TachePurge & { bornes: Date[] } {
  const bornes: Date[] = [];
  return {
    nom,
    retentionJours,
    bornes,
    executer: (borne: Date) => {
      bornes.push(borne);
      return resultat instanceof Error
        ? Promise.reject(resultat)
        : Promise.resolve(resultat);
    },
  };
}

function options(taches: readonly TachePurge[]): OptionsPurge {
  return { outbox: null, deadLetter: null, taches };
}

function service(taches: readonly TachePurge[]): PurgeService {
  return new PurgeService(horloge, db, options(taches));
}

beforeEach(() => {
  addLignes.mockClear();
  addEchecs.mockClear();
});

describe('PurgeService — calcul de la borne', () => {
  /**
   * Le cœur du critère du lot : la borne est **dérivée de l'horloge injectée**, pas de
   * `new Date()`. Sans cela, « une ligne juste sous la borne survit » ne serait pas
   * prouvable — et le patron partagé dont ce service s'inspire (`OutboxRelay`) est
   * justement celui qui appelait `new Date()` en dur.
   */
  it('retranche exactement la rétention de la tâche à l’instant de l’horloge', async () => {
    const t = tache('notification', 365);
    await service([t]).executer();
    expect(t.bornes).toEqual([new Date('2025-08-12T10:00:00.000Z')]);
  });

  it('donne à chaque tâche sa propre borne, calculée sur le même instant', async () => {
    const court = tache('outbox', 30);
    const long = tache('dead_letter', 90);
    await service([court, long]).executer();
    expect(court.bornes[0]).toEqual(new Date('2026-07-13T10:00:00.000Z'));
    expect(long.bornes[0]).toEqual(new Date('2026-05-14T10:00:00.000Z'));
  });
});

describe('PurgeService — robustesse du cycle', () => {
  it('isole les tâches : une table indisponible n’empêche pas les suivantes', async () => {
    const cassee = tache('outbox', 30, new Error('base indisponible'));
    const suivante = tache('dead_letter', 90, 4);
    await service([cassee, suivante]).executer();
    expect(suivante.bornes).toHaveLength(1);
    expect(addEchecs).toHaveBeenCalledWith(1, { tache: 'outbox' });
    expect(addLignes).toHaveBeenCalledWith(4, { tache: 'dead_letter' });
  });

  it('compte les lignes traitées par tâche, y compris un cycle sans effet', async () => {
    await service([tache('notification', 365, 0)]).executer();
    expect(addLignes).toHaveBeenCalledWith(0, { tache: 'notification' });
    expect(addEchecs).not.toHaveBeenCalled();
  });

  /**
   * Garde de réentrance — jamais testée ailleurs dans le dépôt : un cycle encore en vol
   * doit faire retourner immédiatement, sinon deux balayages concurrents se marchent
   * dessus au premier passage (le plus long, sur des tables jamais nettoyées).
   */
  it('ne relance pas un cycle tant que le précédent est en vol', async () => {
    let liberer = (): void => undefined;
    const enVol = new Promise<number>((resoudre) => {
      liberer = () => {
        resoudre(0);
      };
    });
    const bornes: Date[] = [];
    const lente: TachePurge = {
      nom: 'lente',
      retentionJours: 30,
      executer: (borne) => {
        bornes.push(borne);
        return enVol;
      },
    };
    const s = service([lente]);
    const premier = s.executer();
    await s.executer(); // second tick pendant le premier cycle
    expect(bornes).toHaveLength(1);
    liberer();
    await premier;
    await s.executer(); // le cycle est terminé : celui-ci passe
    expect(bornes).toHaveLength(2);
  });
});

describe('PurgeService — composition des tâches mutualisées', () => {
  it('n’ajoute aucune tâche technique quand le service ne porte ni outbox ni dead_letter', async () => {
    await service([tache('notification', 365)]).executer();
    expect(addLignes).toHaveBeenCalledTimes(1);
    expect(addLignes).toHaveBeenCalledWith(1, { tache: 'notification' });
  });

  it('ajoute outbox et dead_letter en tête quand les tables sont déclarées', async () => {
    const compte = vi.fn(() => Promise.resolve({ count: 0 }));
    const dbAvecDelete = {
      delete: () => ({ where: compte }),
    } as unknown as PostgresJsDatabase;
    const s = new PurgeService(horloge, dbAvecDelete, {
      outbox: { publishedAt: {} },
      deadLetter: { createdAt: {} },
      taches: [],
    } as unknown as OptionsPurge);
    await s.executer();
    expect(addLignes.mock.calls.map(([, attrs]) => attrs)).toEqual([
      { tache: 'outbox' },
      { tache: 'dead_letter' },
    ]);
  });
});

describe('PurgeService — cycle de vie', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('démarre un balayage périodique au boot et l’arrête à l’extinction', () => {
    vi.useFakeTimers();
    const s = service([tache('notification', 365)]);
    s.onApplicationBootstrap();
    expect(vi.getTimerCount()).toBe(1);
    s.onApplicationShutdown();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('supporte une extinction sans démarrage', () => {
    expect(() => {
      service([]).onApplicationShutdown();
    }).not.toThrow();
  });
});
