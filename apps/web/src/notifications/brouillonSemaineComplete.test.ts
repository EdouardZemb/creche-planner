import { describe, it, expect } from 'vitest';
import { composerBrouillonSemaineComplete } from './brouillonSemaineComplete';
import type {
  BrouillonEtablissement,
  ContratBesoinsSemaine,
  PlageHoraire,
  SaisieJourBesoins,
} from '../types/bff';

// Semaine 2026-W27 : lundi 29 juin → dimanche 5 juillet.
const JOURS = [
  '2026-06-29',
  '2026-06-30',
  '2026-07-01',
  '2026-07-02',
  '2026-07-03',
  '2026-07-04',
  '2026-07-05',
];

function plage(h1: number, m1: number, h2: number, m2: number): PlageHoraire {
  return { debutHeures: h1, debutMinutes: m1, finHeures: h2, finMinutes: m2 };
}

function jourVide(): SaisieJourBesoins {
  return {
    joursSupplementaires: [],
    absences: [],
    ajustements: [],
    exceptions: [],
    joursAlsh: [],
  };
}

/** Contrat crèche : gardé 08:00–17:00 du lundi au vendredi (base), sans exception. */
function contratCreche(
  contratId: string,
  enfant: string,
  besoins: ContratBesoinsSemaine['besoins'] = {},
): ContratBesoinsSemaine {
  return {
    contratId,
    enfant,
    mode: 'CRECHE_PSU',
    etablissementId: 'etab-1',
    besoins,
    semaineType: {
      LUNDI: [plage(8, 0, 17, 0)],
      MARDI: [plage(8, 0, 17, 0)],
      MERCREDI: [plage(8, 0, 17, 0)],
      JEUDI: [plage(8, 0, 17, 0)],
      VENDREDI: [plage(8, 0, 17, 0)],
    },
  };
}

function brouillon(
  enfants: BrouillonEtablissement['enfants'],
): BrouillonEtablissement {
  return {
    foyerId: 'foyer-1',
    semaineIso: '2026-W27',
    etablissementId: 'etab-1',
    etablissementLibelle: 'Crèche Les Hirondelles',
    destinataire: 'contact@example.org',
    sujet: 'objet serveur',
    corps: '<p>corps serveur</p>',
    texte: 'texte serveur',
    enfants,
    routable: true,
    raisonNonRoutable: null,
    dryRun: true,
  };
}

/** La ligne du corps contenant `aiguille` (chaîne vide si absente). */
function ligneContenant(corps: string, aiguille: string): string {
  return corps.split('\n').find((l) => l.includes(aiguille)) ?? '';
}

describe('composerBrouillonSemaineComplete', () => {
  it('liste LES 7 jours et ne marque « (modifié) » que le jour du delta', () => {
    // Léa : absente toute la journée le mardi 30 juin (delta = ce seul jour).
    const besoins: ContratBesoinsSemaine['besoins'] = {
      '2026-06-30': {
        ...jourVide(),
        absences: [
          {
            date: '2026-06-30',
            ...plage(8, 0, 17, 0),
            preavisJours: 0,
            certificatMaladie: false,
          },
        ],
      },
    };
    const { sujet, corps } = composerBrouillonSemaineComplete({
      jours: JOURS,
      contrats: [contratCreche('c-lea', 'Léa', besoins)],
      brouillon: brouillon([
        {
          contratId: 'c-lea',
          enfant: 'Léa',
          deltaModifs: {
            jours: [{ date: '2026-06-30', avant: {}, apres: null }],
          },
        },
      ]),
    });

    // Objet daté au lundi, en langage parent.
    expect(sujet).toBe('Planning de la semaine du lundi 29 juin — Léa');

    // Les 7 jours de la semaine sont présents (pas seulement le jour modifié).
    for (const label of [
      'lundi 29 juin',
      'mardi 30 juin',
      'mercredi 1 juillet',
      'jeudi 2 juillet',
      'vendredi 3 juillet',
      'samedi 4 juillet',
      'dimanche 5 juillet',
    ]) {
      expect(corps).toContain(label);
    }

    // Un seul « (modifié) », porté par le jour du delta (mardi), pas les autres.
    // (Les lignes jour-par-jour sont préfixées « - » — distinctes de l'intro qui
    // cite aussi « lundi 29 juin »/« dimanche 5 juillet ».)
    expect(corps.match(/\(modifié\)/g)).toHaveLength(1);
    const mardi = ligneContenant(corps, '- mardi 30 juin');
    expect(mardi).toContain('Absent');
    expect(mardi).toContain('(modifié)');
    expect(ligneContenant(corps, '- lundi 29 juin')).not.toContain('(modifié)');

    // Jour normal (base) : présence effective ; week-end : pas de garde.
    expect(ligneContenant(corps, '- lundi 29 juin')).toContain(
      'Gardé · 08:00–17:00',
    );
    expect(ligneContenant(corps, '- samedi 4 juillet')).toContain(
      'Pas de garde',
    );
    expect(ligneContenant(corps, '- dimanche 5 juillet')).toContain(
      'Pas de garde',
    );

    // Corps en phrases de parent (salutation + intro datée + clôture).
    expect(corps).toContain('Bonjour,');
    expect(corps).toContain(
      'Voici le planning complet de la semaine du lundi 29 juin au dimanche 5 juillet pour Léa',
    );
    expect(corps).toContain('Bien cordialement,');
  });

  it('agrège plusieurs enfants (objet + intro en liste française)', () => {
    const { sujet, corps } = composerBrouillonSemaineComplete({
      jours: JOURS,
      contrats: [contratCreche('c-lea', 'Léa'), contratCreche('c-noe', 'Noé')],
      brouillon: brouillon([
        {
          contratId: 'c-lea',
          enfant: 'Léa',
          deltaModifs: {
            jours: [{ date: '2026-06-29', avant: null, apres: {} }],
          },
        },
        {
          contratId: 'c-noe',
          enfant: 'Noé',
          deltaModifs: {
            jours: [{ date: '2026-07-01', avant: null, apres: {} }],
          },
        },
      ]),
    });

    expect(sujet).toBe('Planning de la semaine du lundi 29 juin — Léa et Noé');
    expect(corps).toContain('pour Léa et Noé');
    // Un bloc par enfant (en-tête avec le mode accentué).
    expect(corps).toContain('Léa — Crèche :');
    expect(corps).toContain('Noé — Crèche :');
  });
});
