import { describe, it, expect } from 'vitest';
import type {
  AbsenceCreche,
  AjustementJour,
  ContratBesoinsSemaine,
  EtablissementConcerne,
  JourAlsh,
  JourSupplementaire,
  PlageHoraire,
  SaisieJourBesoins,
  SemaineBesoins,
} from '../types/bff';
import { lignesDuJour } from './jourFoyer';

// Jours de référence (juin/juillet 2026) : le 30/06 est un MARDI, le 04/07 un SAMEDI.
const MARDI = '2026-06-30';
const SAMEDI = '2026-07-04';

/** `PlageHoraire` depuis deux libellés `HH:MM`. */
function plage(debut: string, fin: string): PlageHoraire {
  const d = debut.split(':').map(Number);
  const f = fin.split(':').map(Number);
  return {
    debutHeures: d[0] ?? 0,
    debutMinutes: d[1] ?? 0,
    finHeures: f[0] ?? 0,
    finMinutes: f[1] ?? 0,
  };
}

function absence(debut: string, fin: string): AbsenceCreche {
  return {
    date: MARDI,
    ...plage(debut, fin),
    preavisJours: 0,
    certificatMaladie: false,
  };
}

function jourSup(debut: string, fin: string): JourSupplementaire {
  return { date: MARDI, ...plage(debut, fin) };
}

function ajustement(debut: string, fin: string): AjustementJour {
  return {
    date: MARDI,
    ...plage(debut, fin),
    preavisJours: 0,
    certificatMaladie: false,
  };
}

/** Construit un `SaisieJourBesoins` (catégories vides par défaut). */
function besoinsJour(
  partial: Partial<SaisieJourBesoins> = {},
): SaisieJourBesoins {
  return {
    joursSupplementaires: [],
    absences: [],
    ajustements: [],
    exceptions: [],
    joursAlsh: [],
    ...partial,
  };
}

const ETAB: EtablissementConcerne = {
  etablissementId: 'etab-1',
  libelle: 'Crèche Les Lutins',
  preavisRegle: null,
};

/**
 * `SemaineBesoins` minimale autour d'un unique contrat (un seul item attendu en
 * sortie, sinon `[]`). `etablissements` par défaut = annuaire avec `etab-1`.
 */
function vue(
  contrat: ContratBesoinsSemaine,
  etablissements: EtablissementConcerne[] = [ETAB],
): SemaineBesoins {
  return {
    semaineIso: '2026-W27',
    jours: [
      '2026-06-29',
      MARDI,
      '2026-07-01',
      '2026-07-02',
      '2026-07-03',
      SAMEDI,
      '2026-07-05',
    ],
    etablissements,
    contrats: [contrat],
  };
}

function contratCreche(
  over: Partial<ContratBesoinsSemaine> = {},
): ContratBesoinsSemaine {
  return {
    contratId: 'c-creche',
    enfant: 'Lina',
    mode: 'CRECHE_PSU',
    etablissementId: 'etab-1',
    besoins: {},
    semaineType: { MARDI: [plage('08:30', '16:30')] },
    ...over,
  };
}

function contratAbcm(
  mode: 'CANTINE' | 'PERISCOLAIRE' | 'ALSH',
  over: Partial<ContratBesoinsSemaine> = {},
): ContratBesoinsSemaine {
  return {
    contratId: `c-${mode}`,
    enfant: 'Noé',
    mode,
    etablissementId: 'etab-1',
    besoins: {},
    semaineAbcm: {},
    ...over,
  };
}

describe('lignesDuJour — crèche (CRECHE_PSU)', () => {
  it('journée de base → « garde » avec horaire de la semaine-type', () => {
    const lignes = lignesDuJour(vue(contratCreche()), MARDI);
    expect(lignes).toHaveLength(1);
    expect(lignes[0]).toMatchObject({
      contratId: 'c-creche',
      enfant: 'Lina',
      mode: 'CRECHE_PSU',
      etablissementLibelle: 'Crèche Les Lutins',
      etat: 'garde',
      horaire: '08:30–16:30',
    });
  });

  it('absence couvrant toute la garde → « absent », sans horaire', () => {
    const c = contratCreche({
      besoins: {
        [MARDI]: besoinsJour({ absences: [absence('08:30', '16:30')] }),
      },
    });
    expect(lignesDuJour(vue(c), MARDI)[0]).toMatchObject({
      etat: 'absent',
      horaire: null,
    });
  });

  it('absence en fin de journée → « depart-avance » avec la présence retenue', () => {
    const c = contratCreche({
      besoins: {
        [MARDI]: besoinsJour({ absences: [absence('15:00', '16:30')] }),
      },
    });
    expect(lignesDuJour(vue(c), MARDI)[0]).toMatchObject({
      etat: 'depart-avance',
      horaire: '08:30–15:00',
    });
  });

  it('absence en début de journée → « arrivee-retardee » avec la présence retenue', () => {
    const c = contratCreche({
      besoins: {
        [MARDI]: besoinsJour({ absences: [absence('08:30', '10:00')] }),
      },
    });
    expect(lignesDuJour(vue(c), MARDI)[0]).toMatchObject({
      etat: 'arrivee-retardee',
      horaire: '10:00–16:30',
    });
  });

  it('absence intérieure → « ajuste » sans présence dérivable', () => {
    const c = contratCreche({
      besoins: {
        [MARDI]: besoinsJour({ absences: [absence('11:00', '14:00')] }),
      },
    });
    expect(lignesDuJour(vue(c), MARDI)[0]).toMatchObject({
      etat: 'ajuste',
      horaire: null,
    });
  });

  it('jour ajouté hors semaine-type → « jour-ajoute » avec son horaire', () => {
    const c = contratCreche({
      semaineType: {},
      besoins: {
        [MARDI]: besoinsJour({
          joursSupplementaires: [jourSup('09:00', '12:00')],
        }),
      },
    });
    expect(lignesDuJour(vue(c), MARDI)[0]).toMatchObject({
      etat: 'jour-ajoute',
      horaire: '09:00–12:00',
    });
  });

  it('ajustement d’heures : arrivée avancée → « arrivee-avancee » + présence réelle', () => {
    // Base 08:30–16:30 (semaine-type) ; présence réelle 08:00–16:30.
    const c = contratCreche({
      besoins: {
        [MARDI]: besoinsJour({ ajustements: [ajustement('08:00', '16:30')] }),
      },
    });
    expect(lignesDuJour(vue(c), MARDI)[0]).toMatchObject({
      etat: 'arrivee-avancee',
      horaire: '08:00–16:30',
    });
  });

  it('ajustement d’heures : départ retardé → « depart-retarde »', () => {
    const c = contratCreche({
      besoins: {
        [MARDI]: besoinsJour({ ajustements: [ajustement('08:30', '18:00')] }),
      },
    });
    expect(lignesDuJour(vue(c), MARDI)[0]).toMatchObject({
      etat: 'depart-retarde',
      horaire: '08:30–18:00',
    });
  });

  it('ajustement d’heures : deux bornes décalées → « ajuste »', () => {
    const c = contratCreche({
      besoins: {
        [MARDI]: besoinsJour({ ajustements: [ajustement('08:00', '18:00')] }),
      },
    });
    expect(lignesDuJour(vue(c), MARDI)[0]).toMatchObject({
      etat: 'ajuste',
      horaire: '08:00–18:00',
    });
  });

  it('jour non gardé (pas de base, pas de saisie) → filtré', () => {
    // Le MARDI a une base mais on interroge le SAMEDI (hors semaine-type).
    expect(lignesDuJour(vue(contratCreche()), SAMEDI)).toEqual([]);
  });
});

describe('lignesDuJour — cantine (CANTINE)', () => {
  it('semaine-type avec cantine → « cantine »', () => {
    const c = contratAbcm('CANTINE', {
      semaineAbcm: { MARDI: { cantine: true } },
    });
    expect(lignesDuJour(vue(c), MARDI)[0]).toMatchObject({
      etat: 'cantine',
      horaire: null,
    });
  });

  it('exception activant la cantine sur une base sans cantine → « cantine »', () => {
    const c = contratAbcm('CANTINE', {
      semaineAbcm: { MARDI: { cantine: false } },
      besoins: {
        [MARDI]: besoinsJour({ exceptions: [{ date: MARDI, cantine: true }] }),
      },
    });
    expect(lignesDuJour(vue(c), MARDI)[0]?.etat).toBe('cantine');
  });

  it('exception retirant la cantine d’une base avec cantine → filtré', () => {
    const c = contratAbcm('CANTINE', {
      semaineAbcm: { MARDI: { cantine: true } },
      besoins: {
        [MARDI]: besoinsJour({ exceptions: [{ date: MARDI, cantine: false }] }),
      },
    });
    expect(lignesDuJour(vue(c), MARDI)).toEqual([]);
  });

  it('ni base ni exception → filtré', () => {
    expect(lignesDuJour(vue(contratAbcm('CANTINE')), MARDI)).toEqual([]);
  });
});

describe('lignesDuJour — périscolaire (PERISCOLAIRE)', () => {
  it('matin seul → « peri » horaire « matin »', () => {
    const c = contratAbcm('PERISCOLAIRE', {
      semaineAbcm: { MARDI: { periMatin: true } },
    });
    expect(lignesDuJour(vue(c), MARDI)[0]).toMatchObject({
      etat: 'peri',
      horaire: 'matin',
    });
  });

  it('soir seul → « peri » horaire « soir »', () => {
    const c = contratAbcm('PERISCOLAIRE', {
      semaineAbcm: { MARDI: { periSoir: true } },
    });
    expect(lignesDuJour(vue(c), MARDI)[0]?.horaire).toBe('soir');
  });

  it('matin et soir → horaire « matin + soir »', () => {
    const c = contratAbcm('PERISCOLAIRE', {
      semaineAbcm: { MARDI: { periMatin: true, periSoir: true } },
    });
    expect(lignesDuJour(vue(c), MARDI)[0]?.horaire).toBe('matin + soir');
  });

  it('exception sans matin ni soir (sans péri) → filtré', () => {
    const c = contratAbcm('PERISCOLAIRE', {
      semaineAbcm: { MARDI: { periMatin: true } },
      besoins: {
        [MARDI]: besoinsJour({
          exceptions: [{ date: MARDI, periMatin: false, periSoir: false }],
        }),
      },
    });
    expect(lignesDuJour(vue(c), MARDI)).toEqual([]);
  });
});

describe('lignesDuJour — ALSH', () => {
  const jourAlsh = (over: Partial<JourAlsh>): JourAlsh => ({
    date: MARDI,
    type: 'COMPLETE',
    ...over,
  });

  it('demi-journée', () => {
    const c = contratAbcm('ALSH', {
      besoins: {
        [MARDI]: besoinsJour({ joursAlsh: [jourAlsh({ type: 'DEMI' })] }),
      },
    });
    expect(lignesDuJour(vue(c), MARDI)[0]).toMatchObject({
      etat: 'alsh',
      horaire: 'Demi-journée',
    });
  });

  it('journée complète sans repas', () => {
    const c = contratAbcm('ALSH', {
      besoins: {
        [MARDI]: besoinsJour({ joursAlsh: [jourAlsh({ type: 'COMPLETE' })] }),
      },
    });
    expect(lignesDuJour(vue(c), MARDI)[0]?.horaire).toBe('Journée');
  });

  it('journée complète avec repas', () => {
    const c = contratAbcm('ALSH', {
      besoins: {
        [MARDI]: besoinsJour({
          joursAlsh: [jourAlsh({ type: 'COMPLETE', repas: true })],
        }),
      },
    });
    expect(lignesDuJour(vue(c), MARDI)[0]?.horaire).toBe('Journée + repas');
  });

  it('aucune réservation ce jour → filtré', () => {
    expect(lignesDuJour(vue(contratAbcm('ALSH')), MARDI)).toEqual([]);
  });

  it('récurrence hebdomadaire : jour de semaine-type inscrit → présent', () => {
    const c = contratAbcm('ALSH', {
      semaineAbcm: { MARDI: { alsh: { type: 'COMPLETE', repas: true } } },
    });
    expect(lignesDuJour(vue(c), MARDI)[0]).toMatchObject({
      etat: 'alsh',
      horaire: 'Journée + repas',
    });
  });

  it('récurrence : exception alsh=false retire le jour', () => {
    const c = contratAbcm('ALSH', {
      semaineAbcm: { MARDI: { alsh: { type: 'COMPLETE' } } },
      besoins: {
        [MARDI]: besoinsJour({
          exceptions: [{ date: MARDI, alsh: false }],
        }),
      },
    });
    expect(lignesDuJour(vue(c), MARDI)).toEqual([]);
  });

  it('exception alsh=true sans récurrence → journée complète par défaut', () => {
    const c = contratAbcm('ALSH', {
      besoins: {
        [MARDI]: besoinsJour({
          exceptions: [{ date: MARDI, alsh: true }],
        }),
      },
    });
    expect(lignesDuJour(vue(c), MARDI)[0]).toMatchObject({
      etat: 'alsh',
      horaire: 'Journée',
    });
  });

  it('un jour réservé par date prime sur la récurrence (formule explicite)', () => {
    const c = contratAbcm('ALSH', {
      semaineAbcm: { MARDI: { alsh: { type: 'COMPLETE', repas: true } } },
      besoins: {
        [MARDI]: besoinsJour({ joursAlsh: [jourAlsh({ type: 'DEMI' })] }),
      },
    });
    expect(lignesDuJour(vue(c), MARDI)[0]?.horaire).toBe('Demi-journée');
  });
});

describe('lignesDuJour — établissement & agrégation', () => {
  it('contrat non rattaché → etablissementLibelle null', () => {
    const c = contratCreche({ etablissementId: null });
    expect(lignesDuJour(vue(c), MARDI)[0]?.etablissementLibelle).toBeNull();
  });

  it('etablissementId inconnu de l’annuaire → etablissementLibelle null', () => {
    const c = contratCreche({ etablissementId: 'etab-absent' });
    expect(lignesDuJour(vue(c), MARDI)[0]?.etablissementLibelle).toBeNull();
  });

  it('plusieurs contrats : ne garde que ceux concernés, dans l’ordre de la vue', () => {
    const semaine: SemaineBesoins = {
      semaineIso: '2026-W27',
      jours: vue(contratCreche()).jours,
      etablissements: [ETAB],
      contrats: [
        contratCreche({ contratId: 'c1', enfant: 'Lina' }),
        // Cantine sans base ni exception ce jour → filtré.
        contratAbcm('CANTINE', { contratId: 'c2', enfant: 'Noé' }),
        contratAbcm('ALSH', {
          contratId: 'c3',
          enfant: 'Tom',
          besoins: {
            [MARDI]: besoinsJour({
              joursAlsh: [{ date: MARDI, type: 'DEMI' }],
            }),
          },
        }),
      ],
    };
    const lignes = lignesDuJour(semaine, MARDI);
    expect(lignes.map((l) => l.contratId)).toEqual(['c1', 'c3']);
  });
});
