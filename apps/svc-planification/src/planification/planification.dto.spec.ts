import { describe, expect, it } from 'vitest';
import {
  creerContratSchema,
  ecrirePlanningSchema,
  modifierContratSchema,
  rattacherEtablissementSchema,
  ISO_MOIS,
} from './planification.dto.js';

/**
 * Tests des schémas Zod de validation des DTO (frontière HTTP). Domaine pur côté
 * service ; ici on vérifie uniquement le contrat de validation : payloads valides
 * acceptés, payloads malformés rejetés (dates, UUID, bornes, discriminant `mode`).
 */

const FOYER_ID = '22222222-2222-4222-8222-222222222222';

const JOURS = [
  'LUNDI',
  'MARDI',
  'MERCREDI',
  'JEUDI',
  'VENDREDI',
  'SAMEDI',
  'DIMANCHE',
] as const;

/**
 * Semaine type crèche couvrant les 7 jours. NB : `z.record(enum, …)` (Zod v4)
 * exige TOUTES les clés de l'énum (cf. bug noté dans le rapport) ; un record
 * partiel est rejeté. On fournit donc les 7 jours pour les cas « valides ».
 */
function semaineCompleteCreche(
  plagesLundi: unknown[] = [
    { debutHeures: 8, debutMinutes: 30, finHeures: 17, finMinutes: 0 },
  ],
): Record<string, unknown[]> {
  const sem: Record<string, unknown[]> = {};
  for (const j of JOURS) {
    sem[j] = j === 'LUNDI' ? plagesLundi : [];
  }
  return sem;
}

/** Semaine type ABCM couvrant les 7 jours (même contrainte d'exhaustivité). */
function semaineCompleteAbcm(): Record<string, unknown> {
  const sem: Record<string, unknown> = {};
  for (const j of JOURS) {
    sem[j] = j === 'LUNDI' ? { cantine: true, periMatin: false } : {};
  }
  return sem;
}

describe('creerContratSchema (crèche PSU)', () => {
  const basePsu = {
    mode: 'CRECHE_PSU' as const,
    foyerId: FOYER_ID,
    enfant: 'Mia',
    valideDu: '2026-01-01',
    valideAu: '2026-12-31',
    heuresAnnuellesContractualisees: 885.5,
    nbMensualites: 7,
    semaineType: semaineCompleteCreche(),
  };

  it('accepte un contrat crèche valide', () => {
    expect(creerContratSchema.safeParse(basePsu).success).toBe(true);
  });

  it('accepte valideAu null (période ouverte)', () => {
    expect(
      creerContratSchema.safeParse({ ...basePsu, valideAu: null }).success,
    ).toBe(true);
  });

  it('rejette une date de validité mal formée', () => {
    expect(
      creerContratSchema.safeParse({ ...basePsu, valideDu: '2026-1-1' })
        .success,
    ).toBe(false);
  });

  it.each(['2026-13-45', '2026-02-30', '2023-02-29'])(
    'rejette une date de validité non calendaire : %s (AQ-04)',
    (valideDu) => {
      expect(
        creerContratSchema.safeParse({ ...basePsu, valideDu }).success,
      ).toBe(false);
    },
  );

  it('accepte un 29 février bissextile (AQ-04)', () => {
    expect(
      creerContratSchema.safeParse({ ...basePsu, valideDu: '2024-02-29' })
        .success,
    ).toBe(true);
  });

  it('rejette un foyerId non-UUID', () => {
    expect(
      creerContratSchema.safeParse({ ...basePsu, foyerId: 'pas-un-uuid' })
        .success,
    ).toBe(false);
  });

  it('rejette un enfant vide', () => {
    expect(
      creerContratSchema.safeParse({ ...basePsu, enfant: '' }).success,
    ).toBe(false);
  });

  it('rejette des heures annuelles négatives', () => {
    expect(
      creerContratSchema.safeParse({
        ...basePsu,
        heuresAnnuellesContractualisees: -1,
      }).success,
    ).toBe(false);
  });

  it('rejette nbMensualites < 1', () => {
    expect(
      creerContratSchema.safeParse({ ...basePsu, nbMensualites: 0 }).success,
    ).toBe(false);
  });

  it('rejette nbMensualites non entier', () => {
    expect(
      creerContratSchema.safeParse({ ...basePsu, nbMensualites: 2.5 }).success,
    ).toBe(false);
  });

  it('rejette une plage horaire avec finHeures hors borne (> 24)', () => {
    expect(
      creerContratSchema.safeParse({
        ...basePsu,
        semaineType: semaineCompleteCreche([
          { debutHeures: 8, debutMinutes: 0, finHeures: 25, finMinutes: 0 },
        ]),
      }).success,
    ).toBe(false);
  });

  it('rejette un jour de semaine inconnu dans la semaine type', () => {
    expect(
      creerContratSchema.safeParse({
        ...basePsu,
        semaineType: { ...semaineCompleteCreche(), FUNDIDAY: [] },
      }).success,
    ).toBe(false);
  });
});

describe('creerContratSchema (ABCM)', () => {
  const baseAbcm = {
    mode: 'CANTINE' as const,
    foyerId: FOYER_ID,
    enfant: 'Zoé',
    valideDu: '2026-09-01',
    valideAu: null,
    semaineAbcm: semaineCompleteAbcm(),
  };

  it('accepte un contrat cantine valide', () => {
    expect(creerContratSchema.safeParse(baseAbcm).success).toBe(true);
  });

  it.each(['CANTINE', 'PERISCOLAIRE', 'ALSH'])(
    'accepte le mode ABCM %s',
    (mode) => {
      expect(creerContratSchema.safeParse({ ...baseAbcm, mode }).success).toBe(
        true,
      );
    },
  );

  it('rejette un mode inconnu (discriminant invalide)', () => {
    expect(
      creerContratSchema.safeParse({ ...baseAbcm, mode: 'GARDERIE' }).success,
    ).toBe(false);
  });

  it('rejette un contrat ABCM portant des champs crèche au lieu de semaineAbcm', () => {
    // Branche cantine : `semaineAbcm` requis, `semaineType` n'est pas une clé valide.
    const resultat = creerContratSchema.safeParse({
      mode: 'CANTINE',
      foyerId: FOYER_ID,
      enfant: 'Zoé',
      valideDu: '2026-09-01',
      valideAu: null,
      semaineType: { LUNDI: [] },
    });
    expect(resultat.success).toBe(false);
  });
});

describe('creerContratSchema (lien établissement, P2)', () => {
  const basePsu = {
    mode: 'CRECHE_PSU' as const,
    foyerId: FOYER_ID,
    enfant: 'Mia',
    valideDu: '2026-01-01',
    valideAu: '2026-12-31',
    heuresAnnuellesContractualisees: 885.5,
    nbMensualites: 7,
    semaineType: semaineCompleteCreche(),
  };
  const ETAB_ID = '99999999-9999-4999-8999-999999999999';

  it('accepte un contrat sans établissement (les deux liens absents)', () => {
    expect(creerContratSchema.safeParse(basePsu).success).toBe(true);
  });

  it('accepte un etablissementId existant', () => {
    expect(
      creerContratSchema.safeParse({ ...basePsu, etablissementId: ETAB_ID })
        .success,
    ).toBe(true);
  });

  it('rejette un etablissementId non-UUID', () => {
    expect(
      creerContratSchema.safeParse({ ...basePsu, etablissementId: 'x' })
        .success,
    ).toBe(false);
  });

  it('accepte un nouvelEtablissement (création à la volée)', () => {
    expect(
      creerContratSchema.safeParse({
        ...basePsu,
        nouvelEtablissement: {
          nom: 'Crèche du centre',
          emailService: 'service@creche.example',
          types: ['CRECHE_PSU'],
        },
      }).success,
    ).toBe(true);
  });

  it('rejette un nouvelEtablissement sans nom', () => {
    expect(
      creerContratSchema.safeParse({
        ...basePsu,
        nouvelEtablissement: { emailService: 'service@creche.example' },
      }).success,
    ).toBe(false);
  });

  it('rejette la fourniture des DEUX liens à la fois (exclusivité)', () => {
    expect(
      creerContratSchema.safeParse({
        ...basePsu,
        etablissementId: ETAB_ID,
        nouvelEtablissement: { nom: 'Doublon' },
      }).success,
    ).toBe(false);
  });

  it('porte aussi sur la branche ABCM (etablissementId accepté)', () => {
    expect(
      creerContratSchema.safeParse({
        mode: 'CANTINE',
        foyerId: FOYER_ID,
        enfant: 'Zoé',
        valideDu: '2026-09-01',
        valideAu: null,
        semaineAbcm: semaineCompleteAbcm(),
        etablissementId: ETAB_ID,
      }).success,
    ).toBe(true);
  });
});

describe('modifierContratSchema', () => {
  it('réutilise la même union que la création (crèche valide accepté)', () => {
    expect(
      modifierContratSchema.safeParse({
        mode: 'CRECHE_PSU',
        foyerId: FOYER_ID,
        enfant: 'Mia',
        valideDu: '2026-01-01',
        valideAu: '2026-12-31',
        heuresAnnuellesContractualisees: 885.5,
        nbMensualites: 7,
        semaineType: semaineCompleteCreche(),
      }).success,
    ).toBe(true);
  });
});

describe('rattacherEtablissementSchema (back-fill P5)', () => {
  const ETAB_ID = '99999999-9999-4999-8999-999999999999';

  it('accepte un etablissementId UUID', () => {
    expect(
      rattacherEtablissementSchema.safeParse({ etablissementId: ETAB_ID })
        .success,
    ).toBe(true);
  });

  it('rejette un etablissementId absent', () => {
    expect(rattacherEtablissementSchema.safeParse({}).success).toBe(false);
  });

  it('rejette un etablissementId non-UUID', () => {
    expect(
      rattacherEtablissementSchema.safeParse({ etablissementId: 'x' }).success,
    ).toBe(false);
  });
});

describe('ecrirePlanningSchema', () => {
  it('accepte un objet vide (tous champs optionnels)', () => {
    expect(ecrirePlanningSchema.safeParse({}).success).toBe(true);
  });

  it('accepte une saisie crèche complète (complément, jours sup, absences)', () => {
    expect(
      ecrirePlanningSchema.safeParse({
        complementMinutes: 60,
        joursSupplementaires: [
          {
            date: '2026-10-05',
            debutHeures: 8,
            debutMinutes: 0,
            finHeures: 17,
            finMinutes: 0,
          },
        ],
        absences: [
          {
            date: '2026-10-06',
            debutHeures: 8,
            debutMinutes: 0,
            finHeures: 12,
            finMinutes: 0,
            preavisJours: 3,
            certificatMaladie: false,
          },
        ],
      }).success,
    ).toBe(true);
  });

  it('accepte une absence sans date (date optionnelle)', () => {
    expect(
      ecrirePlanningSchema.safeParse({
        absences: [
          {
            debutHeures: 8,
            debutMinutes: 0,
            finHeures: 12,
            finMinutes: 0,
            preavisJours: 0,
            certificatMaladie: true,
          },
        ],
      }).success,
    ).toBe(true);
  });

  it('rejette une absence sans preavisJours (champ requis)', () => {
    expect(
      ecrirePlanningSchema.safeParse({
        absences: [
          {
            debutHeures: 8,
            debutMinutes: 0,
            finHeures: 12,
            finMinutes: 0,
            certificatMaladie: false,
          },
        ],
      }).success,
    ).toBe(false);
  });

  it('rejette un complementMinutes négatif', () => {
    expect(
      ecrirePlanningSchema.safeParse({ complementMinutes: -1 }).success,
    ).toBe(false);
  });

  it('rejette une date de jour supplémentaire mal formée', () => {
    expect(
      ecrirePlanningSchema.safeParse({
        joursSupplementaires: [
          {
            date: '10-2026-05',
            debutHeures: 8,
            debutMinutes: 0,
            finHeures: 17,
            finMinutes: 0,
          },
        ],
      }).success,
    ).toBe(false);
  });

  it('rejette une date de jour supplémentaire non calendaire (2026-02-30, AQ-04)', () => {
    expect(
      ecrirePlanningSchema.safeParse({
        joursSupplementaires: [
          {
            date: '2026-02-30',
            debutHeures: 8,
            debutMinutes: 0,
            finHeures: 17,
            finMinutes: 0,
          },
        ],
      }).success,
    ).toBe(false);
  });

  it('accepte des exceptions ABCM (overrides par date)', () => {
    expect(
      ecrirePlanningSchema.safeParse({
        exceptions: [
          { date: '2026-10-05', cantine: true },
          { date: '2026-10-06', periSoir: false },
        ],
      }).success,
    ).toBe(true);
  });

  it('accepte des jours ALSH (type COMPLETE/DEMI)', () => {
    expect(
      ecrirePlanningSchema.safeParse({
        joursAlsh: [
          { date: '2026-10-07', type: 'COMPLETE', repas: true },
          { date: '2026-10-14', type: 'DEMI' },
        ],
      }).success,
    ).toBe(true);
  });

  it('rejette un type ALSH inconnu', () => {
    expect(
      ecrirePlanningSchema.safeParse({
        joursAlsh: [{ date: '2026-10-07', type: 'TRIPLE' }],
      }).success,
    ).toBe(false);
  });
});

describe('ISO_MOIS', () => {
  it('valide un mois bien formé', () => {
    expect(ISO_MOIS.test('2026-10')).toBe(true);
  });

  it.each(['2026-1', '2026/10', '2026-10-01', 'octobre'])(
    'rejette un mois mal formé : %s',
    (mois) => {
      expect(ISO_MOIS.test(mois)).toBe(false);
    },
  );

  it.each(['2026-00', '2026-13'])(
    'rejette un mois hors calendrier : %s (AQ-04)',
    (mois) => {
      expect(ISO_MOIS.test(mois)).toBe(false);
    },
  );

  it.each(['2026-01', '2026-09', '2026-12'])(
    'accepte les bornes de mois valides : %s',
    (mois) => {
      expect(ISO_MOIS.test(mois)).toBe(true);
    },
  );
});
