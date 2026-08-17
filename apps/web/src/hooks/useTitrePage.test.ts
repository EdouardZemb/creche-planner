import { describe, it, expect } from 'vitest';
import { renderHook } from '@testing-library/react';
import { NOM_PRODUIT, titreDocument, useTitrePage } from './useTitrePage';
import { titreDepuisPathname } from '../layout/titreDepuisPathname';

describe('titreDocument', () => {
  it('n’appose pas le suffixe au repli neutre (pas de « Martha — Martha »)', () => {
    // Le repli de `titreDepuisPathname` VAUT le nom du produit : sur `/`, sur un écran
    // de récupération et sur la 404, l'onglet doit dire « Martha », pas le dire deux
    // fois. Les trois chemins sont exercés, parce que c'est le repli qui est en cause
    // et non un titre de page.
    for (const pathname of ['/', '/route-inconnue', '/foyers/abc/inexistant']) {
      expect(titreDepuisPathname(pathname)).toBe(NOM_PRODUIT);
      expect(titreDocument(titreDepuisPathname(pathname))).toBe(NOM_PRODUIT);
    }
  });

  it('appose le suffixe à un titre de page ordinaire', () => {
    expect(titreDocument('Planning')).toBe(`Planning — ${NOM_PRODUIT}`);
  });
});

describe('useTitrePage', () => {
  it('pose document.title avec le suffixe', () => {
    renderHook(() => {
      useTitrePage('Planning');
    });
    expect(document.title).toBe('Planning — Martha');
  });

  it('restaure le titre précédent au démontage', () => {
    document.title = 'Initial';
    const { unmount } = renderHook(() => {
      useTitrePage('Contrats');
    });
    expect(document.title).toBe('Contrats — Martha');
    unmount();
    expect(document.title).toBe('Initial');
  });
});
