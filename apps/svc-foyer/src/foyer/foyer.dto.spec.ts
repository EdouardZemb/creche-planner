import { describe, expect, it } from 'vitest';
import {
  ajouterEnfantSchema,
  ajouterParentSchema,
  modifierParentSchema,
} from './foyer.dto.js';

/**
 * AQ-04 (doc 27) — la date de naissance d'un enfant doit être une date
 * calendaire réelle, pas seulement la forme `\d{4}-\d{2}-\d{2}`.
 */
describe('ajouterEnfantSchema — date de naissance calendaire (AQ-04)', () => {
  it('accepte une date de naissance valide (dont 29 février bissextile)', () => {
    expect(
      ajouterEnfantSchema.safeParse({
        prenom: 'Mia',
        dateNaissance: '2022-10-04',
      }).success,
    ).toBe(true);
    expect(
      ajouterEnfantSchema.safeParse({
        prenom: 'Zoé',
        dateNaissance: '2024-02-29',
      }).success,
    ).toBe(true);
  });

  it.each(['2026-13-45', '2026-02-30', '2023-02-29', '04/10/2022'])(
    'rejette « %s » avec le message de validation',
    (dateNaissance) => {
      const resultat = ajouterEnfantSchema.safeParse({
        prenom: 'Mia',
        dateNaissance,
      });
      expect(resultat.success).toBe(false);
      if (!resultat.success) {
        expect(resultat.error.issues[0]?.message).toBe(
          'date ISO YYYY-MM-DD attendue',
        );
      }
    },
  );
});

describe('ajouterParentSchema', () => {
  it('accepte un e-mail seul et applique les défauts (principal=false, ordre=0)', () => {
    const resultat = ajouterParentSchema.safeParse({
      email: 'parent@example.com',
    });
    expect(resultat.success).toBe(true);
    if (resultat.success) {
      expect(resultat.data).toMatchObject({ principal: false, ordre: 0 });
    }
  });

  it('rejette un e-mail invalide avec le message dédié', () => {
    const resultat = ajouterParentSchema.safeParse({ email: 'pas-un-email' });
    expect(resultat.success).toBe(false);
    if (!resultat.success) {
      expect(resultat.error.issues[0]?.message).toBe('adresse e-mail invalide');
    }
  });

  it('rejette un ordre négatif', () => {
    expect(
      ajouterParentSchema.safeParse({
        email: 'parent@example.com',
        ordre: -1,
      }).success,
    ).toBe(false);
  });
});

describe('modifierParentSchema (édition partielle)', () => {
  it('accepte un corps vide (aucun champ modifié)', () => {
    expect(modifierParentSchema.safeParse({}).success).toBe(true);
  });

  it('autorise null pour effacer prénom/nom', () => {
    const resultat = modifierParentSchema.safeParse({
      prenom: null,
      nom: null,
    });
    expect(resultat.success).toBe(true);
    if (resultat.success) {
      expect(resultat.data.prenom).toBeNull();
    }
  });

  it('rejette un e-mail invalide quand il est fourni', () => {
    expect(modifierParentSchema.safeParse({ email: 'x' }).success).toBe(false);
  });
});
