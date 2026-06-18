import { describe, it, expect } from 'vitest';
import { renderHook } from '@testing-library/react';
import { useTitrePage } from './useTitrePage';

describe('useTitrePage', () => {
  it('pose document.title avec le suffixe', () => {
    renderHook(() => {
      useTitrePage('Planning');
    });
    expect(document.title).toBe('Planning — Crèche Planner');
  });

  it('restaure le titre précédent au démontage', () => {
    document.title = 'Initial';
    const { unmount } = renderHook(() => {
      useTitrePage('Contrats');
    });
    expect(document.title).toBe('Contrats — Crèche Planner');
    unmount();
    expect(document.title).toBe('Initial');
  });
});
