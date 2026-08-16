import { describe, it, expect, vi } from 'vitest';
import {
  codeProbleme,
  extraireErreurs,
  focaliserSection,
  messageErreur,
} from './erreurs';
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

  /**
   * `AM-55` : le refus de calculer un mois sans ressources connues arrive en **422**.
   * Sans lecture du code métier, il empruntait le message générique du statut —
   * « vérifiez les champs marqués », sur un écran qui n'a pas de formulaire.
   */
  it('422 + RESSOURCES_INCONNUES_AU_MOIS → dit ce qui manque et comment le réparer', () => {
    const message = messageErreur(
      new ApiError(422, {
        code: 'RESSOURCES_INCONNUES_AU_MOIS',
        title: 'Unprocessable Content',
      }),
    );

    expect(message).toMatch(/ressources déclarées/i);
    expect(message).toMatch(/date d’effet/i);
    // Et surtout : plus le message de validation de formulaire.
    expect(message).not.toMatch(/champs marqués/i);
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

/**
 * AQ-12 : implémentation unique, partagée par FoyerFormPage et ContratForm.
 *
 * Les corps ci-dessous sont ceux que la passerelle émet **réellement** depuis le
 * lot 4 des standards (RFC 9457) — un problème dont le membre `erreurs` porte le
 * détail par champ. La version précédente de ces tests attendait un tableau à la
 * racine, forme que le fil n'a jamais eue : c'est `AN-21`.
 */
describe('extraireErreurs', () => {
  /** Enveloppe minimale d'un problème 400 portant `erreurs`. */
  function probleme(erreurs: unknown): unknown {
    return {
      type: 'about:blank',
      title: 'Requête invalide',
      status: 400,
      erreurs,
    };
  }

  it('extrait les erreurs par champ du membre `erreurs`', () => {
    const erreurs = [
      { champ: 'rfr', message: 'RFR invalide' },
      { champ: 'nbParts', message: 'Nombre de parts requis' },
    ];
    expect(extraireErreurs(probleme(erreurs))).toEqual(erreurs);
  });

  it('filtre les entrées partielles ou mal typées', () => {
    const erreurs = [
      { champ: 'rfr', message: 'RFR invalide' },
      { champ: 'sansMessage' },
      { message: 'sans champ' },
      { champ: 42, message: 'champ non-string' },
      'texte brut',
      null,
    ];
    expect(extraireErreurs(probleme(erreurs))).toEqual([
      { champ: 'rfr', message: 'RFR invalide' },
    ]);
  });

  it('renvoie [] pour un problème sans membre `erreurs`', () => {
    expect(
      extraireErreurs({ type: 'about:blank', title: 'Conflit', status: 409 }),
    ).toEqual([]);
    expect(extraireErreurs(probleme('pas un tableau'))).toEqual([]);
  });

  it('renvoie [] pour tout corps qui n’est pas un problème', () => {
    // Notamment le tableau nu que ces tests attendaient avant `AN-21` : la
    // passerelle ne l'a jamais émis, il ne doit plus rien produire ici.
    expect(extraireErreurs([{ champ: 'rfr', message: 'x' }])).toEqual([]);
    expect(extraireErreurs('erreur')).toEqual([]);
    expect(extraireErreurs(undefined)).toEqual([]);
    expect(extraireErreurs(null)).toEqual([]);
  });
});

describe('codeProbleme', () => {
  it('lit le code métier d’un problème', () => {
    expect(
      codeProbleme({
        type: 'urn:probleme:creche-planner:email-deja-utilise',
        title: 'adresse e-mail déjà utilisée dans ce foyer',
        status: 409,
        code: 'EMAIL_DEJA_UTILISE',
      }),
    ).toBe('EMAIL_DEJA_UTILISE');
  });

  it('renvoie undefined quand le problème n’en porte pas', () => {
    expect(codeProbleme({ type: 'about:blank', status: 409 })).toBeUndefined();
    expect(codeProbleme({ code: 42 })).toBeUndefined();
    expect(codeProbleme(undefined)).toBeUndefined();
    expect(codeProbleme([{ code: 'DANS_UN_TABLEAU' }])).toBeUndefined();
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
