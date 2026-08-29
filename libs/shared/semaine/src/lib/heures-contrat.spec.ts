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
    const verdict = coherenceHeuresAnnuelles(SEMAINE_RENTREE, 1607);
    expect(verdict.coherent).toBe(false);
    expect(verdict.heuresHebdomadaires).toBe(27);
    // 1607 ÷ 27 = 59,52 semaines — le chiffre qui rend l'absurdité lisible.
    expect(verdict.semainesEquivalentes).toBe(59.52);
  });

  it('ACCEPTE le contrat précédent du même enfant (885,5 h à 32,5 h/sem)', () => {
    expect(coherenceHeuresAnnuelles(SEMAINE_ANCIENNE, 885.5).coherent).toBe(
      true,
    );
  });

  it('ACCEPTE le jeu de données de référence du dépôt, tel quel', () => {
    // `scripts/seed-demo.mjs` : lundi/mercredi/vendredi 8 h 30 → 17 h 00 (25,5 h),
    // 831,5 h et 885,5 h sur janvier→juillet, avec des coûts que QUATRE specs e2e
    // assertent. Une garde qui les refuserait changerait le modèle du produit, pas
    // un garde-fou — c'est ce qui a fait abandonner la borne sur la période.
    const semaineSeed: SemaineTypeHeures = {
      LUNDI: [plage(8, 30, 17, 0)],
      MERCREDI: [plage(8, 30, 17, 0)],
      VENDREDI: [plage(8, 30, 17, 0)],
    };
    expect(heuresHebdomadaires(semaineSeed)).toBe(25.5);
    expect(coherenceHeuresAnnuelles(semaineSeed, 831.5).coherent).toBe(true);
    expect(coherenceHeuresAnnuelles(semaineSeed, 885.5).coherent).toBe(true);
  });

  it('accepte exactement 52 semaines, refuse au-delà', () => {
    // 27 h/semaine × 52 = 1404 h : la dernière valeur tenable.
    expect(coherenceHeuresAnnuelles(SEMAINE_RENTREE, 1404).coherent).toBe(true);
    expect(coherenceHeuresAnnuelles(SEMAINE_RENTREE, 1404.5).coherent).toBe(
      false,
    );
  });

  it('ne dépend PAS de la période : un contrat de 7 mois n’est pas re-proratisé', () => {
    // Même valeur, période courte ou longue : le verdict est le même. C'est la
    // convention du produit (les heures annuelles ne sont pas proratisées).
    expect(coherenceHeuresAnnuelles(SEMAINE_ANCIENNE, 885.5).coherent).toBe(
      true,
    );
  });

  it('n’a aucun avis sur une valeur non numérique (champ vide en cours de saisie)', () => {
    const verdict = coherenceHeuresAnnuelles(SEMAINE_RENTREE, Number.NaN);
    expect(verdict.coherent).toBe(true);
    // Sans cette garde, le message afficherait « NaN h » au parent.
    expect(messageCoherenceHeures(verdict, Number.NaN)).toBeNull();
  });

  it('n’a aucun avis sur une semaine type vide (défaut d’un autre ordre)', () => {
    const verdict = coherenceHeuresAnnuelles({}, 1607);
    expect(verdict.coherent).toBe(true);
    expect(verdict.semainesEquivalentes).toBeNull();
  });
});

describe('messageCoherenceHeures', () => {
  it('compte en SEMAINES — l’unité qu’un parent comprend sans calcul', () => {
    const verdict = coherenceHeuresAnnuelles(SEMAINE_RENTREE, 1607);
    expect(messageCoherenceHeures(verdict, 1607)).toBe(
      '1607 h à 27 h par semaine représentent 59,52 semaines de garde, alors ' +
        "qu'une année n'en compte que 52.",
    );
  });

  it('écrit les décimales à la française (virgule, pas point)', () => {
    const semaine: SemaineTypeHeures = { LUNDI: [plage(9, 0, 16, 30)] }; // 7,5 h
    const verdict = coherenceHeuresAnnuelles(semaine, 600);
    expect(verdict.coherent).toBe(false);
    expect(messageCoherenceHeures(verdict, 600)).toBe(
      '600 h à 7,5 h par semaine représentent 80 semaines de garde, alors ' +
        "qu'une année n'en compte que 52.",
    );
  });

  it('rend null quand il n’y a rien à signaler', () => {
    const verdict = coherenceHeuresAnnuelles(SEMAINE_ANCIENNE, 885.5);
    expect(messageCoherenceHeures(verdict, 885.5)).toBeNull();
  });
});
