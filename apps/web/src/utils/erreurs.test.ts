import { describe, it, expect, vi } from 'vitest';
import { extraireErreurs, focaliserSection, messageErreur } from './erreurs';
import { ApiError } from '../api/client';

describe('messageErreur', () => {
  it('502 → message de service indisponible', () => {
    expect(messageErreur(new ApiError(502, undefined))).toMatch(
      /Service indisponible/i,
    );
  });

  it('503 et autres 5xx → service indisponible', () => {
    expect(messageErreur(new ApiError(503, undefined))).toMatch(
      /Service indisponible/i,
    );
    expect(messageErreur(new ApiError(500, undefined))).toMatch(
      /Service indisponible/i,
    );
  });

  it('404 → ressource introuvable', () => {
    expect(messageErreur(new ApiError(404, undefined))).toMatch(/introuvable/i);
  });

  it('409 → conflit', () => {
    expect(messageErreur(new ApiError(409, undefined))).toMatch(/Conflit/i);
  });

  it('400/422 → données invalides', () => {
    expect(messageErreur(new ApiError(400, undefined))).toMatch(/invalides/i);
    expect(messageErreur(new ApiError(422, undefined))).toMatch(/invalides/i);
  });

  // UT-04 (CA2) : le message générique oriente vers les champs/section à vérifier.
  it('400/422 → message orientant (champs marqués / section)', () => {
    expect(messageErreur(new ApiError(400, undefined))).toMatch(
      /champs marqués|section/i,
    );
  });

  it('TypeError (fetch réseau) → service indisponible', () => {
    expect(messageErreur(new TypeError('Failed to fetch'))).toMatch(
      /Service indisponible/i,
    );
  });

  it('Error standard → message conservé', () => {
    expect(messageErreur(new Error('Boom'))).toBe('Boom');
  });

  it('valeur inconnue → message générique', () => {
    expect(messageErreur('oops')).toMatch(/inattendue/i);
  });
});

// AQ-12 : implémentation unique, partagée par FoyerFormPage et ContratForm.
describe('extraireErreurs', () => {
  it('extrait les erreurs par champ d’un tableau conforme', () => {
    const corps = [
      { champ: 'rfr', message: 'RFR invalide' },
      { champ: 'nbParts', message: 'Nombre de parts requis' },
    ];
    expect(extraireErreurs(corps)).toEqual(corps);
  });

  it('filtre les entrées partielles ou mal typées', () => {
    const corps = [
      { champ: 'rfr', message: 'RFR invalide' },
      { champ: 'sansMessage' },
      { message: 'sans champ' },
      { champ: 42, message: 'champ non-string' },
      'texte brut',
      null,
    ];
    expect(extraireErreurs(corps)).toEqual([
      { champ: 'rfr', message: 'RFR invalide' },
    ]);
  });

  it('renvoie [] pour tout corps non-tableau (objet, string, undefined)', () => {
    expect(extraireErreurs({ champ: 'rfr', message: 'x' })).toEqual([]);
    expect(extraireErreurs('erreur')).toEqual([]);
    expect(extraireErreurs(undefined)).toEqual([]);
    expect(extraireErreurs(null)).toEqual([]);
  });
});

describe('focaliserSection (UT-04)', () => {
  it('porte le focus sur la cible quand elle est focusable', () => {
    const el = document.createElement('p');
    el.tabIndex = -1;
    document.body.appendChild(el);
    const focusSpy = vi.spyOn(el, 'focus');

    focaliserSection(el);

    expect(focusSpy).toHaveBeenCalledTimes(1);
    el.remove();
  });

  it('ne fait rien sur une cible nulle', () => {
    expect(() => {
      focaliserSection(null);
    }).not.toThrow();
    expect(() => {
      focaliserSection(undefined);
    }).not.toThrow();
  });
});
