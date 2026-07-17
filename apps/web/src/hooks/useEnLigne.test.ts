import { describe, it, expect, afterEach, vi } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useEnLigne } from './useEnLigne';

// jsdom : `navigator.onLine` est (re)définissable → on le pilote pour l'init.
function definirOnLine(valeur: boolean) {
  Object.defineProperty(navigator, 'onLine', {
    configurable: true,
    value: valeur,
  });
}

describe('useEnLigne', () => {
  afterEach(() => {
    definirOnLine(true);
  });

  it('initialise à la valeur de navigator.onLine', () => {
    definirOnLine(false);
    const { result } = renderHook(() => useEnLigne());
    expect(result.current).toBe(false);
  });

  it('passe hors-ligne sur « offline » et en ligne sur « online »', () => {
    definirOnLine(true);
    const { result } = renderHook(() => useEnLigne());
    expect(result.current).toBe(true);

    act(() => {
      window.dispatchEvent(new Event('offline'));
    });
    expect(result.current).toBe(false);

    act(() => {
      window.dispatchEvent(new Event('online'));
    });
    expect(result.current).toBe(true);
  });

  it('se désabonne des événements au démontage', () => {
    const retirer = vi.spyOn(window, 'removeEventListener');
    const { unmount } = renderHook(() => useEnLigne());
    unmount();
    expect(retirer).toHaveBeenCalledWith('online', expect.any(Function));
    expect(retirer).toHaveBeenCalledWith('offline', expect.any(Function));
    retirer.mockRestore();
  });
});
