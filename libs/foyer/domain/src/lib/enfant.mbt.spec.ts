/**
 * MBT — DT-03 (decision table) ; BVA sur le trim (boundary) ; property-based
 * Critère couverture : combinatoire complète (prénom × date) / BVA 3 points (trim) /
 *   property-based (idempotence du trim, acceptation après trim) ;
 * Traçabilité doc 17 ; SUT : libs/foyer/domain/src/lib/enfant.ts (Enfant.creer)
 */
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { Enfant } from './enfant.js';
import {
  DateNaissanceInvalideError,
  PrenomInvalideError,
} from './foyer-error.js';

const DATE_VALIDE = new Date('2024-01-01');
const DATE_NAN = new Date('pas-une-date'); // getTime() → NaN

// ==========================================================================
// DT-03 — Table de décision Enfant.creer (prénom × date) — combinatoire complète
// ==========================================================================

describe('DT-03 — Enfant.creer table de décision (prénom × dateNaissance)', () => {
  interface Cas {
    readonly libelle: string;
    readonly prenom: string;
    readonly date: Date;
    readonly attendu:
      | 'ok'
      | 'PrenomInvalideError'
      | 'DateNaissanceInvalideError';
    readonly prenomNettoye?: string;
  }

  // C1 : prénom non vide après trim ?  C2 : date valide (getTime() non NaN) ?
  // Le SUT valide le prénom AVANT la date : prénom vide → PrenomInvalideError
  // même si la date est NaN.
  const cas: Cas[] = [
    {
      libelle: 'prénom valide, date valide → OK (trim appliqué)',
      prenom: '  Zoé  ',
      date: DATE_VALIDE,
      attendu: 'ok',
      prenomNettoye: 'Zoé',
    },
    {
      libelle: 'prénom valide, date NaN → DateNaissanceInvalideError',
      prenom: 'Mia',
      date: DATE_NAN,
      attendu: 'DateNaissanceInvalideError',
    },
    {
      libelle: 'prénom vide, date valide → PrenomInvalideError',
      prenom: '',
      date: DATE_VALIDE,
      attendu: 'PrenomInvalideError',
    },
    {
      libelle: 'prénom espaces, date valide → PrenomInvalideError',
      prenom: '   ',
      date: DATE_VALIDE,
      attendu: 'PrenomInvalideError',
    },
    {
      libelle: 'prénom vide, date NaN → PrenomInvalideError (priorité prénom)',
      prenom: '',
      date: DATE_NAN,
      attendu: 'PrenomInvalideError',
    },
  ];

  it.each(cas)('$libelle', ({ prenom, date, attendu, prenomNettoye }) => {
    const acte = (): Enfant => Enfant.creer({ prenom, dateNaissance: date });

    if (attendu === 'ok') {
      const enfant = acte();
      expect(enfant.prenom).toBe(prenomNettoye);
      expect(Number.isNaN(enfant.dateNaissance.getTime())).toBe(false);
    } else if (attendu === 'PrenomInvalideError') {
      expect(acte).toThrow(PrenomInvalideError);
    } else {
      expect(acte).toThrow(DateNaissanceInvalideError);
    }
  });
});

// ==========================================================================
// BVA — frontière du trim sur la longueur du prénom (3 points)
// ==========================================================================

describe('BVA — Enfant.creer frontière longueur du prénom après trim', () => {
  const acte = (prenom: string) => (): Enfant =>
    Enfant.creer({ prenom, dateNaissance: DATE_VALIDE });

  it('"   " → longueur 0 après trim (juste sous la borne) → rejeté', () => {
    expect(acte('   ')).toThrow(PrenomInvalideError);
  });

  it('" a " → longueur 1 après trim (la borne) → accepté', () => {
    expect(acte(' a ')().prenom).toBe('a');
  });

  it('"  Zoé  " → longueur 5 après trim (au-dessus) → accepté + trim', () => {
    expect(acte('  Zoé  ')().prenom).toBe('Zoé');
  });
});

// ==========================================================================
// Property-based — idempotence du trim & acceptation après trim
// ==========================================================================

describe('Enfant — propriétés (fast-check)', () => {
  it('idempotence : le prénom stocké est égal à prenom.trim()', () => {
    fc.assert(
      fc.property(fc.string(), (brut) => {
        const attendu = brut.trim();
        if (attendu.length === 0) {
          // Cas couvert ailleurs : trim vide → rejet.
          expect(() =>
            Enfant.creer({ prenom: brut, dateNaissance: DATE_VALIDE }),
          ).toThrow(PrenomInvalideError);
          return;
        }
        const enfant = Enfant.creer({
          prenom: brut,
          dateNaissance: DATE_VALIDE,
        });
        expect(enfant.prenom).toBe(attendu);
        // Idempotence : retrimmer ne change rien.
        expect(enfant.prenom.trim()).toBe(enfant.prenom);
      }),
    );
  });

  it('tout prénom non vide après trim (avec date valide) est accepté', () => {
    fc.assert(
      fc.property(
        // Un cœur non-blanc entouré d'espaces arbitraires.
        fc.tuple(
          fc.stringMatching(/^ *$/),
          fc.string({ minLength: 1 }).filter((s) => s.trim().length > 0),
          fc.stringMatching(/^ *$/),
        ),
        ([gauche, coeur, droite]) => {
          const brut = `${gauche}${coeur}${droite}`;
          const enfant = Enfant.creer({
            prenom: brut,
            dateNaissance: DATE_VALIDE,
          });
          expect(enfant.prenom).toBe(brut.trim());
          expect(enfant.prenom.length).toBeGreaterThan(0);
        },
      ),
    );
  });
});
