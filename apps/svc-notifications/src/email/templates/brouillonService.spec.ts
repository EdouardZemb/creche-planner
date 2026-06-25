import { describe, expect, it } from 'vitest';
import { brouillonService } from './brouillonService.js';
import type { SaisieJour } from '../../validation/validation.diff.js';

/** Sous-ensemble des catégories d'un jour, renseignées au cas par cas. */
interface JourPartiel {
  joursSupplementaires?: unknown[];
  absences?: unknown[];
  exceptions?: unknown[];
  joursAlsh?: unknown[];
}

/** Fabrique un `SaisieJour` à partir des seules catégories renseignées. */
function jour(partiel: JourPartiel): SaisieJour {
  return {
    joursSupplementaires: partiel.joursSupplementaires ?? [],
    absences: partiel.absences ?? [],
    exceptions: partiel.exceptions ?? [],
    joursAlsh: partiel.joursAlsh ?? [],
  };
}

const BASE = {
  enfant: 'Léa',
  semaineIso: '2026-W27',
  etablissementLibelle: 'Crèche Les Hirondelles',
} as const;

describe('brouillonService', () => {
  it('rend le sujet, l’en-tête établissement et le récap des jours modifiés', () => {
    const message = brouillonService({
      ...BASE,
      deltaModifs: {
        jours: [
          { date: '2026-06-29', avant: null, apres: jour({ absences: [{}] }) },
          {
            date: '2026-07-01',
            avant: null,
            apres: jour({ joursSupplementaires: [{}, {}] }),
          },
        ],
      },
    });

    expect(message.subject).toBe(
      'Planning de Léa — semaine 2026-W27 : modifications',
    );
    expect(message.html).toContain('Crèche Les Hirondelles');
    expect(message.text).toContain('29/06/2026 : 1 absence');
    expect(message.text).toContain('01/07/2026 : 2 jours supplémentaires');
  });

  it('décrit une journée retirée du planning (apres absent)', () => {
    const message = brouillonService({
      ...BASE,
      deltaModifs: {
        jours: [
          { date: '2026-06-30', avant: jour({ absences: [{}] }), apres: null },
        ],
      },
    });

    expect(message.text).toContain('30/06/2026 : journée retirée du planning');
  });

  it('indique l’absence de modification quand le delta est vide', () => {
    const message = brouillonService({
      ...BASE,
      deltaModifs: { jours: [] },
    });

    expect(message.text).toContain('Aucune modification déclarée');
    expect(message.html).toContain('Aucune modification déclarée');
  });

  it('cumule plusieurs catégories d’un même jour', () => {
    const message = brouillonService({
      ...BASE,
      deltaModifs: {
        jours: [
          {
            date: '2026-06-29',
            avant: null,
            apres: jour({ absences: [{}], joursAlsh: [{}, {}, {}] }),
          },
        ],
      },
    });

    expect(message.text).toContain('1 absence, 3 jours ALSH');
  });

  it('échappe le prénom et le libellé dans le HTML (anti-injection)', () => {
    const message = brouillonService({
      enfant: '<b>x</b>',
      semaineIso: '2026-W27',
      etablissementLibelle: 'École & Cie <i>',
      deltaModifs: { jours: [] },
    });

    expect(message.html).toContain('&lt;b&gt;x&lt;/b&gt;');
    expect(message.html).not.toContain('<b>x</b>');
    expect(message.html).toContain('École &amp; Cie &lt;i&gt;');
  });
});
