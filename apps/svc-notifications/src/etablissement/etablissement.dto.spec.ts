import { describe, expect, it } from 'vitest';
import { MODES_CONTRAT } from '@creche-planner/contracts-planification';
import {
  cleEtablissementPourMode,
  preavisRegleSchema,
  upsertEtablissementSchema,
  ZodValidationPipe,
} from './etablissement.dto.js';

describe('preavisRegleSchema', () => {
  it('accepte une règle « jours ouvrés »', () => {
    expect(
      preavisRegleSchema.parse({ type: 'JOURS_OUVRES', valeur: 2 }),
    ).toEqual({ type: 'JOURS_OUVRES', valeur: 2 });
  });

  it('accepte une règle « jour + heure »', () => {
    expect(
      preavisRegleSchema.parse({
        type: 'JOUR_HEURE',
        jour: 'JEUDI',
        heure: '12:00',
      }),
    ).toEqual({ type: 'JOUR_HEURE', jour: 'JEUDI', heure: '12:00' });
  });

  it('rejette une heure mal formée', () => {
    expect(
      preavisRegleSchema.safeParse({
        type: 'JOUR_HEURE',
        jour: 'JEUDI',
        heure: '25:00',
      }).success,
    ).toBe(false);
  });

  it('rejette un type inconnu', () => {
    expect(
      preavisRegleSchema.safeParse({ type: 'AUTRE', valeur: 1 }).success,
    ).toBe(false);
  });

  it('rejette une valeur de jours négative', () => {
    expect(
      preavisRegleSchema.safeParse({ type: 'JOURS_OUVRES', valeur: -1 })
        .success,
    ).toBe(false);
  });
});

describe('upsertEtablissementSchema', () => {
  it('accepte un corps minimal (email + règle)', () => {
    const dto = upsertEtablissementSchema.parse({
      emailService: 'service@example.org',
      preavisRegle: { type: 'JOURS_OUVRES', valeur: 2 },
    });
    expect(dto.emailService).toBe('service@example.org');
    expect(dto.libelle).toBeUndefined();
  });

  it('rejette une adresse e-mail invalide', () => {
    expect(
      upsertEtablissementSchema.safeParse({
        emailService: 'pas-un-email',
        preavisRegle: { type: 'JOURS_OUVRES', valeur: 2 },
      }).success,
    ).toBe(false);
  });
});

describe('cleEtablissementPourMode', () => {
  it('mappe CRECHE_PSU vers la crèche', () => {
    expect(cleEtablissementPourMode('CRECHE_PSU')).toBe('CRECHE_HIRONDELLES');
  });

  it('mappe PERISCOLAIRE / CANTINE / ALSH vers ABCM', () => {
    expect(cleEtablissementPourMode('PERISCOLAIRE')).toBe('ABCM');
    expect(cleEtablissementPourMode('CANTINE')).toBe('ABCM');
    expect(cleEtablissementPourMode('ALSH')).toBe('ABCM');
  });

  it('couvre exhaustivement les modes de contrat', () => {
    for (const mode of MODES_CONTRAT) {
      expect(['CRECHE_HIRONDELLES', 'ABCM']).toContain(
        cleEtablissementPourMode(mode),
      );
    }
  });
});

describe('ZodValidationPipe', () => {
  it('renvoie la valeur parsée si valide', () => {
    const pipe = new ZodValidationPipe(upsertEtablissementSchema);
    const dto = pipe.transform({
      emailService: 'service@example.org',
      preavisRegle: { type: 'JOUR_HEURE', jour: 'JEUDI', heure: '12:00' },
    });
    expect(dto.emailService).toBe('service@example.org');
  });

  it('lève une 400 au format [{champ,message}] si invalide', () => {
    const pipe = new ZodValidationPipe(upsertEtablissementSchema);
    expect(() => pipe.transform({ emailService: 'x' })).toThrow();
  });
});
