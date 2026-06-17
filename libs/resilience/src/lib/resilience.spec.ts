import { afterEach, describe, expect, it, vi } from 'vitest';
import { Logger } from '@nestjs/common';
import {
  CircuitBreaker,
  CircuitOuvertError,
  executerOuRepli,
  executerResilient,
  fetchAvecTimeout,
  type OptionsResilience,
} from './resilience.js';

const OPTIONS: OptionsResilience = {
  timeoutMs: 50,
  retries: 1,
  delaiEntreEssaisMs: 1,
};

describe('CircuitBreaker', () => {
  it('reste fermé tant que le seuil d’échecs n’est pas atteint', () => {
    const cb = new CircuitBreaker(3, 1000);
    cb.echec();
    cb.echec();
    expect(cb.etat()).toBe('ferme');
    expect(cb.autoriseAppel()).toBe(true);
  });

  it('s’ouvre au seuil puis passe semi-ouvert après le refroidissement', () => {
    let horloge = 0;
    const cb = new CircuitBreaker(2, 100, () => horloge);
    cb.echec();
    cb.echec();
    expect(cb.etat()).toBe('ouvert');
    expect(cb.autoriseAppel()).toBe(false);

    horloge = 100;
    expect(cb.etat()).toBe('semi-ouvert');
    expect(cb.autoriseAppel()).toBe(true);
  });

  it('un succès referme le circuit et remet le compteur à zéro', () => {
    const cb = new CircuitBreaker(2, 100);
    cb.echec();
    cb.succes();
    cb.echec();
    expect(cb.etat()).toBe('ferme');
  });

  it('utilise des seuils par défaut (3 échecs, 10 s) si non fournis', () => {
    const cb = new CircuitBreaker();
    cb.echec();
    cb.echec();
    expect(cb.etat()).toBe('ferme');
    cb.echec();
    expect(cb.etat()).toBe('ouvert');
  });
});

describe('executerResilient', () => {
  it('réussit sans retry et ferme le circuit', async () => {
    const cb = new CircuitBreaker();
    const op = vi.fn().mockResolvedValue('ok');
    await expect(executerResilient('x', op, cb, OPTIONS)).resolves.toBe('ok');
    expect(op).toHaveBeenCalledTimes(1);
  });

  it('retente jusqu’à retries+1 fois puis propage la dernière erreur', async () => {
    const cb = new CircuitBreaker(5, 1000);
    const op = vi.fn().mockRejectedValue(new Error('boom'));
    await expect(executerResilient('x', op, cb, OPTIONS)).rejects.toThrow(
      'boom',
    );
    expect(op).toHaveBeenCalledTimes(2); // 1 + 1 retry
  });

  it('réussit après un échec transitoire (retry)', async () => {
    const cb = new CircuitBreaker();
    const op = vi
      .fn()
      .mockRejectedValueOnce(new Error('transitoire'))
      .mockResolvedValue('ok');
    await expect(executerResilient('x', op, cb, OPTIONS)).resolves.toBe('ok');
    expect(op).toHaveBeenCalledTimes(2);
  });

  it('court-circuite immédiatement quand le circuit est ouvert', async () => {
    const horloge = 0;
    const cb = new CircuitBreaker(1, 10000, () => horloge);
    cb.echec(); // ouvre le circuit
    const op = vi.fn().mockResolvedValue('ok');
    await expect(executerResilient('x', op, cb, OPTIONS)).rejects.toThrow(
      CircuitOuvertError,
    );
    expect(op).not.toHaveBeenCalled();
  });

  it('emballe une rejection non-Error dans une Error avant de propager', async () => {
    const cb = new CircuitBreaker(5, 1000);
    // retries: 0 → un seul essai, pas de pause.
    const op = vi.fn().mockRejectedValue('panne brute');
    await expect(
      executerResilient('x', op, cb, { ...OPTIONS, retries: 0 }),
    ).rejects.toThrow('panne brute');
    expect(op).toHaveBeenCalledTimes(1);
  });
});

describe('executerOuRepli', () => {
  it('renvoie le repli (sans propager) en cas d’échec total', async () => {
    const cb = new CircuitBreaker(5, 1000);
    const logger = new Logger('test');
    const warn = vi.spyOn(logger, 'warn').mockImplementation(() => undefined);
    const op = vi.fn().mockRejectedValue(new Error('ko'));
    await expect(
      executerOuRepli('x', op, 'repli', cb, OPTIONS, logger),
    ).resolves.toBe('repli');
    expect(warn).toHaveBeenCalledOnce();
  });

  it('renvoie la valeur en cas de succès', async () => {
    const cb = new CircuitBreaker();
    const logger = new Logger('test');
    const op = vi.fn().mockResolvedValue('valeur');
    await expect(
      executerOuRepli('x', op, 'repli', cb, OPTIONS, logger),
    ).resolves.toBe('valeur');
  });
});

describe('fetchAvecTimeout', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('relaie l’URL et le signal d’abandon à fetch (sans init)', async () => {
    const reponse = new Response('ok');
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(reponse);
    await expect(fetchAvecTimeout('http://amont/x', 1000)).resolves.toBe(
      reponse,
    );
    const appel = fetchMock.mock.calls[0];
    if (!appel) {
      throw new Error('fetch n’a pas été appelé');
    }
    const [url, init] = appel;
    expect(url).toBe('http://amont/x');
    expect((init as RequestInit).signal).toBeInstanceOf(AbortSignal);
  });

  it('propage l’init (méthode + corps) tout en conservant le signal', async () => {
    const reponse = new Response('ok');
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(reponse);
    await fetchAvecTimeout('http://amont/x', 1000, {
      method: 'POST',
      body: '{"a":1}',
    });
    const appel = fetchMock.mock.calls[0];
    if (!appel) {
      throw new Error('fetch n’a pas été appelé');
    }
    const init = appel[1] as RequestInit;
    expect(init.method).toBe('POST');
    expect(init.body).toBe('{"a":1}');
    expect(init.signal).toBeInstanceOf(AbortSignal);
  });

  it('avorte la requête au-delà du timeout', async () => {
    vi.useFakeTimers();
    try {
      const fetchMock = vi.spyOn(globalThis, 'fetch').mockImplementation(
        (_url, init) =>
          new Promise((_resoudre, rejeter) => {
            (init as RequestInit).signal?.addEventListener('abort', () =>
              rejeter(new Error('aborted')),
            );
          }),
      );
      const promesse = fetchAvecTimeout('http://amont/lent', 10);
      vi.advanceTimersByTime(10);
      await expect(promesse).rejects.toThrow('aborted');
      expect(fetchMock).toHaveBeenCalledOnce();
    } finally {
      vi.useRealTimers();
    }
  });
});
