import { describe, expect, it } from 'vitest';
import {
  lireCalendrierQuerySchema,
  lireCoucheQuerySchema,
  poserExceptionSchema,
  regimeFeriesSchema,
  remplacerRecurrencesSchema,
  saisirPeriodeSchema,
} from './calendrier.dto.js';

/**
 * Ce que ces schémas gardent n'est pas de la forme pour la forme : chaque refus
 * ci-dessous correspond à une donnée qui, acceptée, ne casserait **rien tout de
 * suite**. Un mode inconnu dort en `jsonb` et casse la résolution des mois plus
 * tard ; un `aLaDate` à offset horaire casse l'équivalence entre comparaison
 * lexicographique et comparaison chronologique, sans rien signaler.
 */

const INSTANT = '2026-05-01T00:00:00.000Z';

describe('lireCalendrierQuerySchema — la plage et l’instant', () => {
  it('accepte une plage sans `aLaDate` (le défaut est « maintenant »)', () => {
    expect(
      lireCalendrierQuerySchema.parse({ du: '2026-03-02', au: '2026-03-31' }),
    ).toEqual({ du: '2026-03-02', au: '2026-03-31' });
  });

  it('accepte un instant UTC de largeur fixe', () => {
    expect(
      lireCalendrierQuerySchema.parse({
        du: '2026-03-02',
        au: '2026-03-02',
        aLaDate: INSTANT,
      }).aLaDate,
    ).toBe(INSTANT);
  });

  it('refuse un instant à offset horaire (comparaison lexicographique cassée)', () => {
    expect(
      lireCalendrierQuerySchema.safeParse({
        du: '2026-03-02',
        au: '2026-03-02',
        aLaDate: '2026-05-01T02:00:00.000+02:00',
      }).success,
    ).toBe(false);
  });

  it('refuse un instant sans millisecondes (largeur non fixe)', () => {
    expect(
      lireCalendrierQuerySchema.safeParse({
        du: '2026-03-02',
        au: '2026-03-02',
        aLaDate: '2026-05-01T00:00:00Z',
      }).success,
    ).toBe(false);
  });

  it('refuse une date nue là où un instant est attendu (les deux axes ne se mélangent pas)', () => {
    expect(
      lireCalendrierQuerySchema.safeParse({
        du: '2026-03-02',
        au: '2026-03-02',
        aLaDate: '2026-05-01',
      }).success,
    ).toBe(false);
  });

  it('refuse une date de calendrier inexistante (31 février)', () => {
    expect(
      lireCalendrierQuerySchema.safeParse({
        du: '2026-02-31',
        au: '2026-03-02',
      }).success,
    ).toBe(false);
  });

  it('exige les deux bornes', () => {
    expect(
      lireCalendrierQuerySchema.safeParse({ du: '2026-03-02' }).success,
    ).toBe(false);
  });
});

describe('lireCoucheQuerySchema', () => {
  it('accepte une query vide', () => {
    expect(lireCoucheQuerySchema.parse({})).toEqual({});
  });

  it('refuse un instant mal formé', () => {
    expect(lireCoucheQuerySchema.safeParse({ aLaDate: 'hier' }).success).toBe(
      false,
    );
  });
});

describe('remplacerRecurrencesSchema', () => {
  it('accepte une semaine type valide', () => {
    const dto = remplacerRecurrencesSchema.parse({
      recurrences: [
        {
          regime: 'SCOLAIRE',
          jourSemaine: 'MERCREDI',
          services: ['ALSH'],
        },
      ],
    });
    expect(dto.recurrences[0]?.services).toEqual(['ALSH']);
  });

  it('accepte une semaine vidée (tout fermer est une saisie légitime)', () => {
    expect(
      remplacerRecurrencesSchema.parse({ recurrences: [] }).recurrences,
    ).toEqual([]);
  });

  it('refuse un service hors catalogue (sinon il dort en base)', () => {
    expect(
      remplacerRecurrencesSchema.safeParse({
        recurrences: [
          {
            regime: 'SCOLAIRE',
            jourSemaine: 'LUNDI',
            services: ['GARDERIE_DU_SOIR'],
          },
        ],
      }).success,
    ).toBe(false);
  });

  it('refuse un régime hebdomadaire inconnu', () => {
    expect(
      remplacerRecurrencesSchema.safeParse({
        recurrences: [{ regime: 'FERIE', jourSemaine: 'LUNDI', services: [] }],
      }).success,
    ).toBe(false);
  });
});

describe('poserExceptionSchema', () => {
  it('accepte une exception sans `services` (= tous)', () => {
    const dto = poserExceptionSchema.parse({
      jour: '2026-03-03',
      type: 'FERMETURE',
      libelle: 'Fermeture exceptionnelle',
    });
    // `undefined`, et non `[]` : l'absence porte « tous les services », la liste
    // vide porterait « aucun ». Le domaine distingue les deux.
    expect(dto.services).toBeUndefined();
  });

  it('accepte une exception ciblée sur un service', () => {
    expect(
      poserExceptionSchema.parse({
        jour: '2026-03-03',
        type: 'OUVERTURE',
        libelle: 'Garderie exceptionnelle',
        services: ['ALSH'],
      }).services,
    ).toEqual(['ALSH']);
  });

  it('refuse un libellé vide (l’écran l’afficherait tel quel)', () => {
    expect(
      poserExceptionSchema.safeParse({
        jour: '2026-03-03',
        type: 'PONT',
        libelle: '',
      }).success,
    ).toBe(false);
  });

  it('refuse un type d’exception inconnu', () => {
    expect(
      poserExceptionSchema.safeParse({
        jour: '2026-03-03',
        type: 'GREVE',
        libelle: 'Grève',
      }).success,
    ).toBe(false);
  });
});

describe('saisirPeriodeSchema', () => {
  it('accepte une période bien bornée', () => {
    expect(
      saisirPeriodeSchema.parse({
        type: 'VACANCES',
        libelle: 'Vacances de printemps',
        du: '2026-04-04',
        au: '2026-04-20',
        anneeScolaire: '2025-2026',
      }).au,
    ).toBe('2026-04-20');
  });

  it('accepte une période d’un seul jour (bornes inclusives)', () => {
    expect(
      saisirPeriodeSchema.safeParse({
        type: 'FERMETURE_ANNUELLE',
        libelle: 'Pont',
        du: '2026-05-15',
        au: '2026-05-15',
      }).success,
    ).toBe(true);
  });

  it('refuse une fin antérieure au début', () => {
    const resultat = saisirPeriodeSchema.safeParse({
      type: 'VACANCES',
      libelle: 'Vacances',
      du: '2026-04-20',
      au: '2026-04-04',
    });
    expect(resultat.success).toBe(false);
  });

  it('refuse une année scolaire mal formée', () => {
    expect(
      saisirPeriodeSchema.safeParse({
        type: 'VACANCES',
        libelle: 'Vacances',
        du: '2026-04-04',
        au: '2026-04-20',
        anneeScolaire: '2026',
      }).success,
    ).toBe(false);
  });

  it('n’accepte pas `source` : cette route pose toujours du MANUEL', () => {
    const dto = saisirPeriodeSchema.parse({
      type: 'VACANCES',
      libelle: 'Vacances',
      du: '2026-04-04',
      au: '2026-04-20',
      source: 'IMPORT',
    });
    // Le schéma STRIPPE la clé — une saisie manuelle ne peut pas se déclarer
    // importée, donc échapper au prochain réimport (CA2, lot 3).
    expect(dto).not.toHaveProperty('source');
  });
});

describe('regimeFeriesSchema', () => {
  it('accepte les deux régimes connus', () => {
    expect(regimeFeriesSchema.parse('FR')).toBe('FR');
    expect(regimeFeriesSchema.parse('FR_ALSACE_MOSELLE')).toBe(
      'FR_ALSACE_MOSELLE',
    );
  });

  it('refuse un régime non encore livré (le plan 32 ajoutera CH_BL)', () => {
    expect(regimeFeriesSchema.safeParse('CH_BL').success).toBe(false);
  });
});
