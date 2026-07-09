import { describe, expect, it } from 'vitest';
import { brouillonServiceAgrege } from './brouillonService.js';
import type { SaisieJour } from '../../validation/validation.diff.js';

/** Sous-ensemble des catégories d'un jour, renseignées au cas par cas. */
interface JourPartiel {
  joursSupplementaires?: unknown[];
  absences?: unknown[];
  exceptions?: unknown[];
  joursAlsh?: unknown[];
  ajustements?: unknown[];
}

/** Fabrique un `SaisieJour` à partir des seules catégories renseignées. */
function jour(partiel: JourPartiel): SaisieJour {
  return {
    joursSupplementaires: partiel.joursSupplementaires ?? [],
    absences: partiel.absences ?? [],
    exceptions: partiel.exceptions ?? [],
    joursAlsh: partiel.joursAlsh ?? [],
    ajustements: partiel.ajustements ?? [],
  };
}

const BASE = {
  semaineIso: '2026-W27',
  etablissementLibelle: 'Crèche Les Hirondelles',
} as const;

describe('brouillonServiceAgrege', () => {
  it('rend le sujet, l’en-tête établissement et un bloc par enfant', () => {
    const message = brouillonServiceAgrege({
      ...BASE,
      enfants: [
        {
          enfant: 'Léa',
          deltaModifs: {
            jours: [
              {
                date: '2026-06-29',
                avant: null,
                apres: jour({ absences: [{}] }),
              },
            ],
          },
        },
        {
          enfant: 'Tom',
          deltaModifs: {
            jours: [
              {
                date: '2026-07-01',
                avant: null,
                apres: jour({ joursSupplementaires: [{}, {}] }),
              },
            ],
          },
        },
      ],
    });

    // 2026-W27 = semaine à cheval sur deux mois (29 juin → 5 juillet).
    expect(message.subject).toBe(
      'Plannings modifiés — semaine du 29 juin au 5 juillet 2026',
    );
    expect(message.subject).not.toMatch(/\d{4}-W\d{2}/);
    expect(message.html).toContain('Crèche Les Hirondelles');
    // Les deux enfants apparaissent, chacun avec ses jours.
    expect(message.text).toContain('Léa :');
    expect(message.text).toContain('29/06/2026 : 1 absence');
    expect(message.text).toContain('Tom :');
    expect(message.text).toContain('01/07/2026 : 2 jours supplémentaires');
    expect(message.html).toContain('<strong>Léa</strong>');
    expect(message.html).toContain('<strong>Tom</strong>');
  });

  it('décrit une journée retirée du planning (apres absent)', () => {
    const message = brouillonServiceAgrege({
      ...BASE,
      enfants: [
        {
          enfant: 'Léa',
          deltaModifs: {
            jours: [
              {
                date: '2026-06-30',
                avant: jour({ absences: [{}] }),
                apres: null,
              },
            ],
          },
        },
      ],
    });

    expect(message.text).toContain('30/06/2026 : journée retirée du planning');
  });

  it('indique l’absence de modification quand aucun enfant n’est concerné', () => {
    const message = brouillonServiceAgrege({ ...BASE, enfants: [] });

    expect(message.text).toContain('Aucune modification déclarée');
    expect(message.html).toContain('Aucune modification déclarée');
  });

  it('rend un ajustement d’heures réelles en clair (présence HH:MM–HH:MM)', () => {
    const message = brouillonServiceAgrege({
      ...BASE,
      enfants: [
        {
          enfant: 'Léa',
          deltaModifs: {
            jours: [
              {
                date: '2026-06-29',
                avant: null,
                apres: jour({
                  ajustements: [
                    {
                      date: '2026-06-29',
                      debutHeures: 8,
                      debutMinutes: 0,
                      finHeures: 16,
                      finMinutes: 30,
                      preavisJours: 0,
                      certificatMaladie: false,
                    },
                  ],
                }),
              },
            ],
          },
        },
      ],
    });

    expect(message.text).toContain('29/06/2026 : présence 08:00–16:30');
    expect(message.html).toContain('présence 08:00–16:30');
  });

  it('cumule plusieurs catégories d’un même jour', () => {
    const message = brouillonServiceAgrege({
      ...BASE,
      enfants: [
        {
          enfant: 'Léa',
          deltaModifs: {
            jours: [
              {
                date: '2026-06-29',
                avant: null,
                apres: jour({ absences: [{}], joursAlsh: [{}, {}, {}] }),
              },
            ],
          },
        },
      ],
    });

    expect(message.text).toContain('1 absence, 3 jours ALSH');
  });

  it('échappe le prénom et le libellé dans le HTML (anti-injection)', () => {
    const message = brouillonServiceAgrege({
      semaineIso: '2026-W27',
      etablissementLibelle: 'École & Cie <i>',
      enfants: [{ enfant: '<b>x</b>', deltaModifs: { jours: [] } }],
    });

    expect(message.html).toContain('&lt;b&gt;x&lt;/b&gt;');
    expect(message.html).not.toContain('<b>x</b>');
    expect(message.html).toContain('École &amp; Cie &lt;i&gt;');
  });
});
