import { describe, expect, it } from 'vitest';
import { joursDeLaSemaine } from '@creche-planner/shared-semaine';
import type {
  ContratVue,
  EtablissementVue,
} from '../clients/planification.client.js';
import {
  agregerSemaineBesoins,
  estContratActifSurSemaine,
  type ContratAvecSaisies,
} from './semaine-besoins.js';

const JOURS_W27 = joursDeLaSemaine('2026-W27'); // 2026-06-29 … 2026-07-05 (à cheval)

// Identifiants d'établissements réels (entité libre, `svc-planification`).
const ID_CRECHE = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const ID_ABCM = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';

const contrat = (
  p: Partial<ContratVue> & Pick<ContratVue, 'mode'>,
): ContratVue => ({
  id: '11111111-1111-1111-1111-111111111111',
  foyerId: '22222222-2222-2222-2222-222222222222',
  enfant: 'Mia',
  etablissementId: null,
  valideDu: '2026-01-01',
  valideAu: null,
  ...p,
});

const HIRONDELLES: EtablissementVue = {
  id: ID_CRECHE,
  foyerId: '22222222-2222-2222-2222-222222222222',
  nom: 'Crèche des Hirondelles',
  emailService: 'creche@example.test',
  preavisRegle: { type: 'JOURS_OUVRES', valeur: 2 },
  types: ['CRECHE_PSU'],
  adresse: null,
  telephone: null,
  contact: null,
  actif: true,
};
const ABCM: EtablissementVue = {
  id: ID_ABCM,
  foyerId: '22222222-2222-2222-2222-222222222222',
  nom: 'École ABCM',
  emailService: 'abcm@example.test',
  preavisRegle: { type: 'JOUR_HEURE', jour: 'JEUDI', heure: '12:00' },
  types: ['PERISCOLAIRE', 'CANTINE', 'ALSH'],
  adresse: null,
  telephone: null,
  contact: null,
  actif: true,
};

describe('estContratActifSurSemaine', () => {
  it('actif quand la période chevauche la semaine (valide_au ouverte)', () => {
    expect(
      estContratActifSurSemaine(
        { valideDu: '2026-01-01', valideAu: null },
        JOURS_W27,
      ),
    ).toBe(true);
  });

  it('inactif si le contrat commence après le dimanche', () => {
    expect(
      estContratActifSurSemaine(
        { valideDu: '2026-07-06', valideAu: null },
        JOURS_W27,
      ),
    ).toBe(false);
  });

  it('inactif si le contrat se termine avant le lundi', () => {
    expect(
      estContratActifSurSemaine(
        { valideDu: '2026-01-01', valideAu: '2026-06-28' },
        JOURS_W27,
      ),
    ).toBe(false);
  });

  it('actif aux bornes exactes (valide_du = dimanche, valide_au = lundi)', () => {
    expect(
      estContratActifSurSemaine(
        { valideDu: '2026-07-05', valideAu: '2026-06-29' },
        JOURS_W27,
      ),
    ).toBe(true);
  });

  it('inactif si la fenêtre de jours est vide', () => {
    expect(
      estContratActifSurSemaine({ valideDu: '2026-01-01', valideAu: null }, []),
    ).toBe(false);
  });
});

describe('agregerSemaineBesoins', () => {
  it('extrait les besoins datés et déduplique les établissements concernés', () => {
    const contrats: ContratAvecSaisies[] = [
      {
        contrat: contrat({
          id: 'c-creche',
          enfant: 'Mia',
          mode: 'CRECHE_PSU',
          etablissementId: ID_CRECHE,
        }),
        saisies: [
          {
            complementMinutes: 30, // scalaire mensuel : ignoré
            absences: [{ date: '2026-06-29', preavisJours: 2 }],
          },
        ],
      },
      {
        contrat: contrat({
          id: 'c-cantine',
          enfant: 'Mia',
          mode: 'CANTINE',
          etablissementId: ID_ABCM,
        }),
        saisies: [{ exceptions: [{ date: '2026-06-30', cantine: true }] }],
      },
      {
        contrat: contrat({
          id: 'c-alsh',
          enfant: 'Léo',
          mode: 'ALSH',
          etablissementId: ID_ABCM,
        }),
        saisies: [{ joursAlsh: [{ date: '2026-07-01', type: 'COMPLETE' }] }],
      },
    ];

    const vue = agregerSemaineBesoins({
      semaineIso: '2026-W27',
      jours: JOURS_W27,
      contrats,
      annuaire: [HIRONDELLES, ABCM],
    });

    expect(vue.semaineIso).toBe('2026-W27');
    expect(vue.jours).toHaveLength(7);
    expect(vue.contrats).toHaveLength(3);

    const creche = vue.contrats.find((c) => c.contratId === 'c-creche');
    expect(creche?.etablissementId).toBe(ID_CRECHE);
    expect(creche?.besoins['2026-06-29']?.absences).toHaveLength(1);
    expect(creche?.besoins['2026-06-29']?.joursAlsh).toHaveLength(0);

    // Les deux contrats rattachés à l'ABCM partagent une seule entrée d'établissement.
    expect(vue.etablissements.map((e) => e.etablissementId).sort()).toEqual(
      [ID_ABCM, ID_CRECHE].sort(),
    );
    // L'établissement réel porte son nom libre et son e-mail (fiche projetée).
    expect(
      vue.etablissements.find((e) => e.etablissementId === ID_ABCM),
    ).toEqual({
      etablissementId: ID_ABCM,
      libelle: 'École ABCM',
      preavisRegle: { type: 'JOUR_HEURE', jour: 'JEUDI', heure: '12:00' },
    });
  });

  it('fusionne les saisies des deux mois d’une semaine à cheval', () => {
    const vue = agregerSemaineBesoins({
      semaineIso: '2026-W27',
      jours: JOURS_W27,
      contrats: [
        {
          contrat: contrat({
            id: 'c1',
            mode: 'CRECHE_PSU',
            etablissementId: ID_CRECHE,
          }),
          saisies: [
            { absences: [{ date: '2026-06-30', preavisJours: 1 }] }, // juin
            { joursSupplementaires: [{ date: '2026-07-02' }] }, // juillet
          ],
        },
      ],
      annuaire: [HIRONDELLES],
    });

    const besoins = vue.contrats[0]?.besoins ?? {};
    expect(Object.keys(besoins).sort()).toEqual(['2026-06-30', '2026-07-02']);
  });

  it('propage la semaine-type (planning de base) selon le mode', () => {
    const vue = agregerSemaineBesoins({
      semaineIso: '2026-W27',
      jours: JOURS_W27,
      contrats: [
        {
          contrat: {
            ...contrat({
              id: 'c-creche',
              mode: 'CRECHE_PSU',
              etablissementId: ID_CRECHE,
            }),
            semaineType: {
              MARDI: [
                {
                  debutHeures: 8,
                  debutMinutes: 0,
                  finHeures: 17,
                  finMinutes: 0,
                },
              ],
            },
          } as ContratVue,
          saisies: [{}],
        },
        {
          contrat: {
            ...contrat({
              id: 'c-cantine',
              mode: 'CANTINE',
              etablissementId: ID_ABCM,
            }),
            semaineAbcm: { JEUDI: { cantine: true } },
          } as ContratVue,
          saisies: [{}],
        },
      ],
      annuaire: [HIRONDELLES, ABCM],
    });

    const creche = vue.contrats.find((c) => c.contratId === 'c-creche');
    expect(creche?.semaineType?.['MARDI']).toEqual([
      { debutHeures: 8, debutMinutes: 0, finHeures: 17, finMinutes: 0 },
    ]);
    expect(creche?.semaineAbcm).toBeUndefined();

    const cantine = vue.contrats.find((c) => c.contratId === 'c-cantine');
    expect(cantine?.semaineAbcm?.['JEUDI']).toEqual({ cantine: true });
    expect(cantine?.semaineType).toBeUndefined();
  });

  it('ignore un mode inconnu (défensif) sans le faire apparaître', () => {
    const vue = agregerSemaineBesoins({
      semaineIso: '2026-W27',
      jours: JOURS_W27,
      contrats: [
        {
          contrat: contrat({
            id: 'c-x',
            mode: 'INCONNU',
            etablissementId: ID_CRECHE,
          }),
          saisies: [{}],
        },
      ],
      annuaire: [HIRONDELLES, ABCM],
    });
    expect(vue.contrats).toHaveLength(0);
    expect(vue.etablissements).toHaveLength(0);
  });

  it('n’inclut pas un établissement concerné absent de l’annuaire', () => {
    const vue = agregerSemaineBesoins({
      semaineIso: '2026-W27',
      jours: JOURS_W27,
      contrats: [
        {
          contrat: contrat({
            id: 'c1',
            mode: 'CANTINE',
            etablissementId: ID_ABCM,
          }),
          saisies: [{}],
        },
      ],
      annuaire: [HIRONDELLES], // l'ABCM réel n'est pas (encore) projeté
    });
    expect(vue.contrats[0]?.etablissementId).toBe(ID_ABCM);
    expect(vue.etablissements).toHaveLength(0);
  });

  it('garde un contrat sans établissement (lien null) hors de tout groupe', () => {
    const vue = agregerSemaineBesoins({
      semaineIso: '2026-W27',
      jours: JOURS_W27,
      contrats: [
        {
          contrat: contrat({
            id: 'c-orphelin',
            mode: 'CRECHE_PSU',
            etablissementId: null,
          }),
          saisies: [{}],
        },
      ],
      annuaire: [HIRONDELLES, ABCM],
    });
    expect(vue.contrats).toHaveLength(1);
    expect(vue.contrats[0]?.etablissementId).toBeNull();
    expect(vue.etablissements).toHaveLength(0);
  });
});
