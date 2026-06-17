import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { usePersistanceAbsences } from './usePersistanceAbsences';

interface AbsenceTest {
  date: string;
  dureeMinutes: number;
}

const A1: AbsenceTest = { date: '2026-03-10', dureeMinutes: 60 };
const A2: AbsenceTest = { date: '2026-04-05', dureeMinutes: 120 };

describe('usePersistanceAbsences', () => {
  beforeEach(() => {
    sessionStorage.clear();
  });

  it('lire renvoie [] pour un (contrat, mois) jamais écrit', () => {
    const { result } = renderHook(() => usePersistanceAbsences<AbsenceTest>());
    expect(result.current.lire('c1', '2026-03')).toEqual([]);
  });

  it('ecrire puis lire restitue les absences du même (contrat, mois)', () => {
    const { result } = renderHook(() => usePersistanceAbsences<AbsenceTest>());
    result.current.ecrire('c1', '2026-03', [A1]);
    expect(result.current.lire('c1', '2026-03')).toEqual([A1]);
  });

  it('ne fuit pas entre deux mois du même contrat', () => {
    const { result } = renderHook(() => usePersistanceAbsences<AbsenceTest>());
    result.current.ecrire('c1', '2026-03', [A1]);
    result.current.ecrire('c1', '2026-04', [A2]);
    expect(result.current.lire('c1', '2026-03')).toEqual([A1]);
    expect(result.current.lire('c1', '2026-04')).toEqual([A2]);
  });

  it('ne fuit pas entre deux contrats du même mois', () => {
    const { result } = renderHook(() => usePersistanceAbsences<AbsenceTest>());
    result.current.ecrire('c1', '2026-03', [A1]);
    expect(result.current.lire('c2', '2026-03')).toEqual([]);
  });

  it('survit à un remontage (persistance hors composant)', () => {
    const premier = renderHook(() => usePersistanceAbsences<AbsenceTest>());
    premier.result.current.ecrire('c1', '2026-03', [A1]);
    premier.unmount();

    const second = renderHook(() => usePersistanceAbsences<AbsenceTest>());
    expect(second.result.current.lire('c1', '2026-03')).toEqual([A1]);
  });

  it("effacer supprime l'entrée ciblée", () => {
    const { result } = renderHook(() => usePersistanceAbsences<AbsenceTest>());
    result.current.ecrire('c1', '2026-03', [A1]);
    result.current.effacer('c1', '2026-03');
    expect(result.current.lire('c1', '2026-03')).toEqual([]);
  });
});

// AQ-12 : l'échec d'écriture (quota dépassé, Storage indisponible) ne doit plus
// être avalé en silence — warning console + état `indisponible` exposé.
describe('usePersistanceAbsences — quota sessionStorage (AQ-12)', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    sessionStorage.clear();
  });

  it("signale l'échec d'écriture : indisponible=true + console.warn, sans throw", () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new DOMException('quota dépassé', 'QuotaExceededError');
    });
    const { result } = renderHook(() => usePersistanceAbsences<AbsenceTest>());

    expect(result.current.indisponible).toBe(false);
    act(() => {
      expect(() => result.current.ecrire('c1', '2026-03', [A1])).not.toThrow();
    });

    expect(result.current.indisponible).toBe(true);
    expect(warn).toHaveBeenCalledTimes(1);
    expect(String(warn.mock.calls[0]?.[0])).toMatch(/indisponible/i);
  });

  it("repasse à disponible dès qu'une écriture aboutit", () => {
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const setItem = vi
      .spyOn(Storage.prototype, 'setItem')
      .mockImplementation(() => {
        throw new DOMException('quota dépassé', 'QuotaExceededError');
      });
    const { result } = renderHook(() => usePersistanceAbsences<AbsenceTest>());

    act(() => {
      result.current.ecrire('c1', '2026-03', [A1]);
    });
    expect(result.current.indisponible).toBe(true);

    setItem.mockRestore();
    act(() => {
      result.current.ecrire('c1', '2026-03', [A1]);
    });
    expect(result.current.indisponible).toBe(false);
    expect(result.current.lire('c1', '2026-03')).toEqual([A1]);
  });
});
