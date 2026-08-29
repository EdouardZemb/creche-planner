import { describe, expect, it } from 'vitest';
import {
  coherenceHeuresAnnuelles,
  heuresHebdomadaires,
  heuresMaximalesSurPeriode,
  messageCoherenceHeures,
  type SemaineTypeHeures,
} from './heures-contrat.js';

/** Plage horaire depuis deux heures pleines/minutes, pour alléger les cas. */
function plage(
  debutHeures: number,
  debutMinutes: number,
  finHeures: number,
  finMinutes: number,
) {
  return { debutHeures, debutMinutes, finHeures, finMinutes };
}

/**
 * **Le cas réel de production** qui a motivé cette garde (créé le 2026-08-29
 * depuis un compte parent) : semaine type de 27 h — lundi, mardi, jeudi de 8 h 30
 * à 17 h 30 — et 1607 h annuelles, la valeur par défaut du formulaire jamais
 * corrigée. 1607 ÷ 27 = 59,5 semaines de garde, quand une année en compte 52.
 */
const SEMAINE_RENTREE: SemaineTypeHeures = {
  LUNDI: [plage(8, 30, 17, 30)],
  MARDI: [plage(8, 30, 17, 30)],
  JEUDI: [plage(8, 30, 17, 30)],
};
const PERIODE_RENTREE = { valideDu: '2026-09-01', valideAu: '2027-07-23' };

/** Le contrat PRÉCÉDENT du même enfant, lui saisi à la main et cohérent. */
const SEMAINE_ANCIENNE: SemaineTypeHeures = {
  LUNDI: [plage(9, 0, 16, 30)], // 7 h 30
  MERCREDI: [plage(8, 30, 17, 0)], // 8 h 30
  JEUDI: [plage(8, 30, 16, 30)], // 8 h
  VENDREDI: [plage(8, 30, 17, 0)], // 8 h 30
};
const PERIODE_ANCIENNE = { valideDu: '2026-01-01', valideAu: '2026-07-24' };

describe('heuresHebdomadaires', () => {
  it('somme les plages de la semaine type (rentrée = 27 h)', () => {
    expect(heuresHebdomadaires(SEMAINE_RENTREE)).toBe(27);
  });

  it('somme plusieurs plages sur un même jour', () => {
    expect(
      heuresHebdomadaires({
        LUNDI: [plage(8, 0, 12, 0), plage(13, 30, 17, 30)],
      }),
    ).toBe(8);
  });

  it('rend 0 pour une semaine type vide', () => {
    expect(heuresHebdomadaires({})).toBe(0);
  });

  it('ignore une plage incohérente (fin avant début) plutôt que de compter négatif', () => {
    expect(heuresHebdomadaires({ LUNDI: [plage(17, 0, 8, 0)] })).toBe(0);
  });
});

describe('heuresMaximalesSurPeriode', () => {
  it('compte les occurrences réelles des jours gardés, pas des semaines entières', () => {
    // 2026-09-01 → 2027-07-23 : 46 lundis, 47 mardis, 47 jeudis, × 9 h = 1260 h.
    // Une formule « nombre de semaines × 27 h » se tromperait aux deux bords.
    expect(heuresMaximalesSurPeriode(SEMAINE_RENTREE, PERIODE_RENTREE)).toBe(
      1260,
    );
  });

  it('majore le contrat précédent du même enfant', () => {
    expect(heuresMaximalesSurPeriode(SEMAINE_ANCIENNE, PERIODE_ANCIENNE)).toBe(
      959,
    );
  });

  it('rend null pour une période ouverte : sans borne haute, aucun plafond', () => {
    expect(
      heuresMaximalesSurPeriode(SEMAINE_RENTREE, {
        valideDu: '2026-09-01',
        valideAu: null,
      }),
    ).toBeNull();
    expect(
      heuresMaximalesSurPeriode(SEMAINE_RENTREE, { valideDu: '2026-09-01' }),
    ).toBeNull();
  });

  it('inclut les deux bornes de la période', () => {
    // Le 7 septembre 2026 est un lundi, gardé 9 h.
    expect(
      heuresMaximalesSurPeriode(SEMAINE_RENTREE, {
        valideDu: '2026-09-07',
        valideAu: '2026-09-07',
      }),
    ).toBe(9);
  });

  it('ignore les jours non gardés de la période', () => {
    // Un samedi et un dimanche : aucun jour gardé.
    expect(
      heuresMaximalesSurPeriode(SEMAINE_RENTREE, {
        valideDu: '2026-09-05',
        valideAu: '2026-09-06',
      }),
    ).toBe(0);
  });

  it('traverse une frontière d année sans se décaler', () => {
    // Du jeudi 31/12/2026 au vendredi 01/01/2027 : seul le jeudi est gardé.
    expect(
      heuresMaximalesSurPeriode(SEMAINE_RENTREE, {
        valideDu: '2026-12-31',
        valideAu: '2027-01-01',
      }),
    ).toBe(9);
  });

  it('rend 0 pour une période vide (fin avant début)', () => {
    expect(
      heuresMaximalesSurPeriode(SEMAINE_RENTREE, {
        valideDu: '2026-09-01',
        valideAu: '2026-08-01',
      }),
    ).toBe(0);
  });

  it('rend null sur une date malformée plutôt qu un plafond faux', () => {
    expect(
      heuresMaximalesSurPeriode(SEMAINE_RENTREE, {
        valideDu: '2026-09',
        valideAu: '2027-07-23',
      }),
    ).toBeNull();
  });

  it('rend null sur une date au bon FORMAT mais inexistante', () => {
    // `2026-13-45` passe la forme `YYYY-MM-DD` et n'existe pourtant pas : sans
    // ce garde-fou, la boucle partirait d'une date invalide et ne finirait pas.
    expect(
      heuresMaximalesSurPeriode(SEMAINE_RENTREE, {
        valideDu: '2026-09-01',
        valideAu: '2026-13-45',
      }),
    ).toBeNull();
    expect(
      heuresMaximalesSurPeriode(SEMAINE_RENTREE, {
        valideDu: '2026-13-45',
        valideAu: '2027-07-23',
      }),
    ).toBeNull();
  });
});

describe('coherenceHeuresAnnuelles', () => {
  it('REFUSE le cas de production : 1607 h pour 27 h/semaine (non-régression)', () => {
    const verdict = coherenceHeuresAnnuelles(
      SEMAINE_RENTREE,
      PERIODE_RENTREE,
      1607,
    );
    expect(verdict.coherent).toBe(false);
    expect(verdict.maximum).toBe(1260);
    expect(verdict.heuresHebdomadaires).toBe(27);
    // 1607 ÷ 27 = 59,52 semaines — le chiffre qui rend l'absurdité lisible.
    expect(verdict.semainesEquivalentes).toBe(59.52);
  });

  it('ACCEPTE le contrat précédent, saisi à la main et cohérent (885,5 h)', () => {
    const verdict = coherenceHeuresAnnuelles(
      SEMAINE_ANCIENNE,
      PERIODE_ANCIENNE,
      885.5,
    );
    expect(verdict.coherent).toBe(true);
    expect(verdict.maximum).toBe(959);
  });

  it('accepte une valeur exactement égale au plafond (borne incluse)', () => {
    expect(
      coherenceHeuresAnnuelles(SEMAINE_RENTREE, PERIODE_RENTREE, 1260).coherent,
    ).toBe(true);
  });

  it('refuse dès le premier dixième d heure au-dessus du plafond', () => {
    expect(
      coherenceHeuresAnnuelles(SEMAINE_RENTREE, PERIODE_RENTREE, 1260.1)
        .coherent,
    ).toBe(false);
  });

  it('n a aucun avis sur une période ouverte (aucun plafond n existe)', () => {
    const verdict = coherenceHeuresAnnuelles(
      SEMAINE_RENTREE,
      { valideDu: '2026-09-01', valideAu: null },
      99999,
    );
    expect(verdict.coherent).toBe(true);
    expect(verdict.maximum).toBeNull();
  });

  it('n a aucun avis sur une valeur non numérique (champ vide en cours de saisie)', () => {
    const verdict = coherenceHeuresAnnuelles(
      SEMAINE_RENTREE,
      PERIODE_RENTREE,
      Number.NaN,
    );
    expect(verdict.coherent).toBe(true);
    // Sans cette garde, le message afficherait « NaN h » au parent.
    expect(messageCoherenceHeures(verdict, Number.NaN)).toBeNull();
  });

  it('n a aucun avis sur une semaine type vide (défaut d un autre ordre)', () => {
    const verdict = coherenceHeuresAnnuelles({}, PERIODE_RENTREE, 1607);
    expect(verdict.coherent).toBe(true);
    expect(verdict.semainesEquivalentes).toBeNull();
  });
});

describe('messageCoherenceHeures', () => {
  it('nomme les trois chiffres, sans sigle ni identifiant technique', () => {
    const verdict = coherenceHeuresAnnuelles(
      SEMAINE_RENTREE,
      PERIODE_RENTREE,
      1607,
    );
    expect(messageCoherenceHeures(verdict, 1607)).toBe(
      'Avec 27 h par semaine, ce contrat représente au maximum 1260 h sur sa ' +
        'période, même sans aucune fermeture. Vous avez saisi 1607 h.',
    );
  });

  it('écrit les décimales à la française (virgule, pas point)', () => {
    // Lundi seul, 9 h 00 → 16 h 30 = 7,5 h/semaine ; deux lundis = 15 h de plafond.
    const semaine: SemaineTypeHeures = { LUNDI: [plage(9, 0, 16, 30)] };
    const periode = { valideDu: '2026-09-07', valideAu: '2026-09-14' };
    const verdict = coherenceHeuresAnnuelles(semaine, periode, 20);
    expect(verdict.coherent).toBe(false);
    expect(messageCoherenceHeures(verdict, 20)).toBe(
      'Avec 7,5 h par semaine, ce contrat représente au maximum 15 h sur sa ' +
        'période, même sans aucune fermeture. Vous avez saisi 20 h.',
    );
  });

  it('rend null quand il n y a rien à signaler', () => {
    const verdict = coherenceHeuresAnnuelles(
      SEMAINE_ANCIENNE,
      PERIODE_ANCIENNE,
      885.5,
    );
    expect(messageCoherenceHeures(verdict, 885.5)).toBeNull();
  });
});
