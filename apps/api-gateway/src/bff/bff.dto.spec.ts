import { describe, expect, it } from 'vitest';
import { ecrireFoyerScalairesSchema } from './bff.dto.js';

describe('ecrireFoyerScalairesSchema', () => {
  const valide = {
    ressourcesMensuelles: 6716.92,
    rfr: 72705,
    nbEnfantsACharge: 2,
    nbParts: 3,
  };

  it('accepte les scalaires d’un foyer', () => {
    const resultat = ecrireFoyerScalairesSchema.safeParse(valide);
    expect(resultat.success).toBe(true);
  });

  it('rejette les enfants/parents (sous-ressources hors scalaires)', () => {
    // `z.object` est strip par défaut : les champs en trop sont ignorés, pas
    // relayés au service. On vérifie qu'ils n'apparaissent pas dans la sortie.
    const resultat = ecrireFoyerScalairesSchema.parse({
      ...valide,
      enfants: [{ prenom: 'Mia', dateNaissance: '2024-12-08' }],
      parents: [{ email: 'alex@example.test' }],
    });
    expect(resultat).toEqual(valide);
    expect('enfants' in resultat).toBe(false);
    expect('parents' in resultat).toBe(false);
  });

  it('refuse des ressources négatives', () => {
    expect(
      ecrireFoyerScalairesSchema.safeParse({
        ...valide,
        ressourcesMensuelles: -1,
      }).success,
    ).toBe(false);
  });

  it('refuse moins d’un enfant à charge', () => {
    expect(
      ecrireFoyerScalairesSchema.safeParse({ ...valide, nbEnfantsACharge: 0 })
        .success,
    ).toBe(false);
  });

  it('refuse un nombre de parts nul', () => {
    expect(
      ecrireFoyerScalairesSchema.safeParse({ ...valide, nbParts: 0 }).success,
    ).toBe(false);
  });
});
