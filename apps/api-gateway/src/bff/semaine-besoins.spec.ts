import { describe, expect, it } from 'vitest';
import { joursDeLaSemaine } from '@creche-planner/shared-semaine';
import type { ContratVue } from '../clients/planification.client.js';
import type { EtablissementVue } from '../clients/notifications.client.js';
import {
  agregerSemaineBesoins,
  estContratActifSurSemaine,
  type ContratAvecSaisies,
} from './semaine-besoins.js';

const JOURS_W27 = joursDeLaSemaine('2026-W27'); // 2026-06-29 … 2026-07-05 (à cheval)

const contrat = (
  p: Partial<ContratVue> & Pick<ContratVue, 'mode'>,
): ContratVue => ({
  id: '11111111-1111-1111-1111-111111111111',
  foyerId: '22222222-2222-2222-2222-222222222222',
  enfant: 'Mia',
  valideDu: '2026-01-01',
  valideAu: null,
  ...p,
});

const HIRONDELLES: EtablissementVue = {
  cle: 'CRECHE_HIRONDELLES',
  libelle: 'Crèche des Hirondelles',
  emailService: 'creche@example.test',
  preavisRegle: { type: 'JOURS_OUVRES', valeur: 2 },
  actif: true,
};
const ABCM: EtablissementVue = {
  cle: 'ABCM',
  libelle: 'École ABCM',
  emailService: 'abcm@example.test',
  preavisRegle: { type: 'JOUR_HEURE', jour: 'JEUDI', heure: '12:00' },
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
        contrat: contrat({ id: 'c-creche', enfant: 'Mia', mode: 'CRECHE_PSU' }),
        saisies: [
          {
            complementMinutes: 30, // scalaire mensuel : ignoré
            absences: [{ date: '2026-06-29', preavisJours: 2 }],
          },
        ],
      },
      {
        contrat: contrat({ id: 'c-cantine', enfant: 'Mia', mode: 'CANTINE' }),
        saisies: [{ exceptions: [{ date: '2026-06-30', cantine: true }] }],
      },
      {
        contrat: contrat({ id: 'c-alsh', enfant: 'Léo', mode: 'ALSH' }),
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
    expect(creche?.etablissementCle).toBe('CRECHE_HIRONDELLES');
    expect(creche?.besoins['2026-06-29']?.absences).toHaveLength(1);
    expect(creche?.besoins['2026-06-29']?.joursAlsh).toHaveLength(0);

    // Les deux contrats ABCM partagent une seule entrée d'établissement.
    expect(vue.etablissements.map((e) => e.cle).sort()).toEqual([
      'ABCM',
      'CRECHE_HIRONDELLES',
    ]);
  });

  it('fusionne les saisies des deux mois d’une semaine à cheval', () => {
    const vue = agregerSemaineBesoins({
      semaineIso: '2026-W27',
      jours: JOURS_W27,
      contrats: [
        {
          contrat: contrat({ id: 'c1', mode: 'CRECHE_PSU' }),
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

  it('ignore un mode inconnu (défensif) sans le faire apparaître', () => {
    const vue = agregerSemaineBesoins({
      semaineIso: '2026-W27',
      jours: JOURS_W27,
      contrats: [
        {
          contrat: contrat({ id: 'c-x', mode: 'INCONNU' }),
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
        { contrat: contrat({ id: 'c1', mode: 'CANTINE' }), saisies: [{}] },
      ],
      annuaire: [HIRONDELLES], // ABCM non configuré
    });
    expect(vue.contrats[0]?.etablissementCle).toBe('ABCM');
    expect(vue.etablissements).toHaveLength(0);
  });
});
