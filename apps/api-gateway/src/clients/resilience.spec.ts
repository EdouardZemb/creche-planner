import { describe, expect, it, vi } from 'vitest';
import { Logger } from '@nestjs/common';
import {
  CircuitBreaker,
  CircuitOuvertError,
  executerOuRepli,
  executerResilient,
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
});

describe('executerOuRepli', () => {
  it('renvoie le repli (sans propager) en cas d’échec total', async () => {
    const cb = new CircuitBreaker(5, 1000);
    const logger = new Logger('test');
    vi.spyOn(logger, 'warn').mockImplementation(() => undefined);
    const op = vi.fn().mockRejectedValue(new Error('ko'));
    await expect(
      executerOuRepli('x', op, 'repli', cb, OPTIONS, logger),
    ).resolves.toBe('repli');
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
