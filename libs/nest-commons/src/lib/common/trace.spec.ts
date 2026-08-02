import { afterEach, describe, expect, it, vi } from 'vitest';
import { trace } from '@opentelemetry/api';
import { traceIdCourant } from './trace.js';

/**
 * `traceIdCourant()` sert la corrélation d'un événement d'intégration à la
 * requête qui l'a produit : chaque message d'outbox le porte. Son cas piège est
 * le `traceId` **tout-à-zéro** que renvoie un span non enregistré — le laisser
 * passer donnerait un identifiant de corrélation partagé par TOUS les
 * événements émis hors requête, donc inutilisable.
 */

const TRACE_ID_VIDE = '00000000000000000000000000000000';

function spanAvec(traceId: string): void {
  vi.spyOn(trace, 'getActiveSpan').mockReturnValue({
    spanContext: () => ({ traceId }),
  } as unknown as ReturnType<typeof trace.getActiveSpan>);
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('traceIdCourant', () => {
  it('reprend le traceId du span actif', () => {
    spanAvec('4bf92f3577b34da6a3ce929d0e0e4736');

    expect(traceIdCourant()).toBe('4bf92f3577b34da6a3ce929d0e0e4736');
  });

  it('génère un identifiant sans tiret quand aucun span n’est actif', () => {
    vi.spyOn(trace, 'getActiveSpan').mockReturnValue(undefined);

    const id = traceIdCourant();
    expect(id).toMatch(/^[0-9a-f]{32}$/);
  });

  it('refuse le traceId tout-à-zéro d’un span non enregistré', () => {
    spanAvec(TRACE_ID_VIDE);

    const id = traceIdCourant();
    expect(id).not.toBe(TRACE_ID_VIDE);
    expect(id).toMatch(/^[0-9a-f]{32}$/);
  });

  it('produit un identifiant DIFFÉRENT à chaque appel hors requête', () => {
    vi.spyOn(trace, 'getActiveSpan').mockReturnValue(undefined);

    expect(traceIdCourant()).not.toBe(traceIdCourant());
  });
});
