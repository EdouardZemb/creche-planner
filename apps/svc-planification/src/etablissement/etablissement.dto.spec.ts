import { describe, expect, it } from 'vitest';
import {
  creerEtablissementSchema,
  modifierEtablissementSchema,
} from './etablissement.dto.js';

describe('creerEtablissementSchema', () => {
  it('accepte un corps minimal (nom seul)', () => {
    const r = creerEtablissementSchema.safeParse({ nom: 'Crèche du centre' });
    expect(r.success).toBe(true);
  });

  it('accepte e-mail, préavis, types et coordonnées', () => {
    const r = creerEtablissementSchema.safeParse({
      nom: 'Crèche du centre',
      emailService: 'service@creche.example',
      preavisRegle: { type: 'JOUR_HEURE', jour: 'JEUDI', heure: '12:00' },
      types: ['CRECHE_PSU', 'CANTINE'],
      adresse: '1 rue des Lilas',
      telephone: '0102030405',
      contact: 'Mme Martin',
      actif: false,
    });
    expect(r.success).toBe(true);
  });

  it('accepte des champs facultatifs explicitement null', () => {
    const r = creerEtablissementSchema.safeParse({
      nom: 'Sans contact',
      emailService: null,
      preavisRegle: null,
      adresse: null,
    });
    expect(r.success).toBe(true);
  });

  it('rejette un nom vide', () => {
    expect(creerEtablissementSchema.safeParse({ nom: '' }).success).toBe(false);
  });

  it('rejette un e-mail invalide', () => {
    const r = creerEtablissementSchema.safeParse({
      nom: 'X',
      emailService: 'pas-un-email',
    });
    expect(r.success).toBe(false);
  });

  it('rejette un type de garde inconnu', () => {
    const r = creerEtablissementSchema.safeParse({
      nom: 'X',
      types: ['GARDERIE'],
    });
    expect(r.success).toBe(false);
  });

  it('rejette une heure de préavis mal formée', () => {
    const r = creerEtablissementSchema.safeParse({
      nom: 'X',
      preavisRegle: { type: 'JOUR_HEURE', jour: 'JEUDI', heure: '25:00' },
    });
    expect(r.success).toBe(false);
  });
});

describe('modifierEtablissementSchema', () => {
  it('accepte un corps vide (aucun champ à modifier)', () => {
    expect(modifierEtablissementSchema.safeParse({}).success).toBe(true);
  });

  it('valide encore le nom s’il est fourni', () => {
    expect(modifierEtablissementSchema.safeParse({ nom: '' }).success).toBe(
      false,
    );
  });
});
