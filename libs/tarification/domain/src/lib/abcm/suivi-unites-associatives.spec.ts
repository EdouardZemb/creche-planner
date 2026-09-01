import { describe, expect, it } from 'vitest';
import { Money } from '@creche-planner/shared-kernel';
import {
  ETATS_SESSION_UA,
  SEUIL_ALERTE_ECHEANCE_JOURS,
  TYPES_SESSION_UA,
  calculerSuiviUa,
  joursEntre,
  type SessionUaCalcul,
} from './suivi-unites-associatives.js';
import { QuantiteInvalideError } from '../core/tarification-error.js';

/** L'engagement de référence de la SFD 40 : 20 UA à 31,25 €, échéance 31/05. */
const ENGAGEMENT = {
  quotaHeures: 20,
  valeurUa: Money.depuisEuros(31.25),
  fin: '2027-05-31',
};

const AUJOURDHUI = '2026-10-01';

function session(
  date: string,
  dureeHeures: number,
  etat: SessionUaCalcul['etat'],
): SessionUaCalcul {
  return { date, dureeHeures, etat };
}

describe('calculerSuiviUa — les trois compteurs (SFD 40 §3.1)', () => {
  it('distingue réalisé, réservé et restant sans double comptage (US-40-04 CA1)', () => {
    const suivi = calculerSuiviUa(
      ENGAGEMENT,
      [
        session('2026-09-12', 4, 'REALISEE'),
        session('2026-09-20', 2, 'REALISEE'),
        session('2026-11-07', 3, 'PREVUE'),
      ],
      AUJOURDHUI,
    );
    expect(suivi.heuresRealisees).toBe(6);
    expect(suivi.heuresReservees).toBe(3);
    expect(suivi.heuresRestantes).toBe(11);
    expect(suivi.heuresAConfirmer).toBe(0);
  });

  it('ne compte une session annulée nulle part, et le restant remonte (US-40-03 CA2)', () => {
    const avant = calculerSuiviUa(
      ENGAGEMENT,
      [session('2026-11-07', 3, 'PREVUE')],
      AUJOURDHUI,
    );
    const apres = calculerSuiviUa(
      ENGAGEMENT,
      [session('2026-11-07', 3, 'ANNULEE')],
      AUJOURDHUI,
    );
    expect(avant.heuresRestantes).toBe(17);
    expect(apres.heuresReservees).toBe(0);
    expect(apres.heuresRestantes).toBe(20);
  });

  it('range une session passée encore PREVUE en « à confirmer », jamais en réalisé (RM-40-06)', () => {
    const suivi = calculerSuiviUa(
      ENGAGEMENT,
      [session('2026-09-20', 4, 'PREVUE')],
      AUJOURDHUI,
    );
    expect(suivi.heuresAConfirmer).toBe(4);
    expect(suivi.heuresRealisees).toBe(0);
    expect(suivi.heuresReservees).toBe(0);
    // Elle n'a rien acquitté : le restant la compte encore à faire.
    expect(suivi.heuresRestantes).toBe(20);
  });

  it('compte la session du jour même comme réservée, pas comme à confirmer', () => {
    const suivi = calculerSuiviUa(
      ENGAGEMENT,
      [session(AUJOURDHUI, 2, 'PREVUE')],
      AUJOURDHUI,
    );
    expect(suivi.heuresReservees).toBe(2);
    expect(suivi.heuresAConfirmer).toBe(0);
  });

  it('plafonne le restant à zéro quand le foyer dépasse son quota', () => {
    const suivi = calculerSuiviUa(
      ENGAGEMENT,
      [session('2026-09-12', 25, 'REALISEE')],
      AUJOURDHUI,
    );
    expect(suivi.heuresRestantes).toBe(0);
    expect(suivi.quotaAtteint).toBe(true);
  });

  it('admet une durée décimale (une demi-heure de ménage existe)', () => {
    const suivi = calculerSuiviUa(
      ENGAGEMENT,
      [session('2026-09-12', 2.5, 'REALISEE')],
      AUJOURDHUI,
    );
    expect(suivi.heuresRealisees).toBe(2.5);
    expect(suivi.heuresRestantes).toBe(17.5);
  });
});

describe('calculerSuiviUa — le coût, branché sur des heures saisies (RM-40-03)', () => {
  it('CT-15 rejoué depuis une saisie réelle : 14 h sur 20 ⇒ 187,50 €', () => {
    const suivi = calculerSuiviUa(
      ENGAGEMENT,
      [session('2026-09-12', 14, 'REALISEE')],
      AUJOURDHUI,
    );
    expect(suivi.coutSiArret.montantCentimes).toBe(18750);
  });

  it('annonce son hypothèse, et les deux projections diffèrent (RM-40-05)', () => {
    const suivi = calculerSuiviUa(
      ENGAGEMENT,
      [
        session('2026-09-12', 14, 'REALISEE'),
        session('2026-11-07', 6, 'PREVUE'),
      ],
      AUJOURDHUI,
    );
    expect(suivi.coutSiArret).toEqual({
      montantCentimes: 18750,
      hypothese: 'SI_TU_TARRETES_LA',
    });
    expect(suivi.coutSiReservationsRealisees).toEqual({
      montantCentimes: 0,
      hypothese: 'SI_TU_REALISES_TES_RESERVATIONS',
    });
  });

  it('CT-16 : quota atteint ⇒ 0 € (caution rendue), US-40-04 CA3', () => {
    const suivi = calculerSuiviUa(
      ENGAGEMENT,
      [session('2026-09-12', 20, 'REALISEE')],
      AUJOURDHUI,
    );
    expect(suivi.quotaAtteint).toBe(true);
    expect(suivi.coutSiArret.montantCentimes).toBe(0);
  });

  it('un créneau réservé n’acquitte rien du coût d’arrêt (RM-40-04)', () => {
    const suivi = calculerSuiviUa(
      ENGAGEMENT,
      [session('2026-11-07', 20, 'PREVUE')],
      AUJOURDHUI,
    );
    expect(suivi.heuresReservees).toBe(20);
    expect(suivi.quotaAtteint).toBe(false);
    expect(suivi.coutSiArret.montantCentimes).toBe(62500);
  });

  it('utilise la valeur d’UA **saisie**, pas le défaut du constructeur (RM-40-02)', () => {
    const suivi = calculerSuiviUa(
      { quotaHeures: 10, valeurUa: Money.depuisEuros(40), fin: '2027-05-31' },
      [session('2026-09-12', 4, 'REALISEE')],
      AUJOURDHUI,
    );
    // (10 − 4) × 40 € = 240 € — impossible à obtenir avec 20 h / 31,25 €.
    expect(suivi.coutSiArret.montantCentimes).toBe(24000);
  });
});

describe('calculerSuiviUa — échéance et alerte (US-40-05)', () => {
  it('compte les jours restants jusqu’à l’échéance', () => {
    const suivi = calculerSuiviUa(ENGAGEMENT, [], '2027-05-01');
    expect(suivi.joursAvantEcheance).toBe(30);
  });

  it('rend un compte négatif quand l’échéance est passée', () => {
    expect(
      calculerSuiviUa(ENGAGEMENT, [], '2027-06-10').joursAvantEcheance,
    ).toBe(-10);
  });

  it('n’alerte pas tant que l’échéance est au-delà du seuil (CA1)', () => {
    expect(calculerSuiviUa(ENGAGEMENT, [], '2026-10-01').alerteEcheance).toBe(
      false,
    );
  });

  it('alerte dès que le restant est positif et l’échéance sous le seuil (CA1)', () => {
    expect(calculerSuiviUa(ENGAGEMENT, [], '2027-05-01').alerteEcheance).toBe(
      true,
    );
  });

  it('cesse d’alerter dès que le restant tombe à zéro, sans action du parent (CA3)', () => {
    const suivi = calculerSuiviUa(
      ENGAGEMENT,
      [session('2027-04-02', 20, 'REALISEE')],
      '2027-05-01',
    );
    expect(suivi.heuresRestantes).toBe(0);
    expect(suivi.alerteEcheance).toBe(false);
  });

  it('accepte un seuil d’alerte paramétré (défaut : 8 semaines)', () => {
    expect(SEUIL_ALERTE_ECHEANCE_JOURS).toBe(56);
    expect(
      calculerSuiviUa(ENGAGEMENT, [], '2026-10-01', 365).alerteEcheance,
    ).toBe(true);
  });

  it('alerte encore quand l’échéance est dépassée et qu’il restait des heures', () => {
    expect(calculerSuiviUa(ENGAGEMENT, [], '2027-06-10').alerteEcheance).toBe(
      true,
    );
  });
});

describe('calculerSuiviUa — gardes de saisie (INV-01)', () => {
  it('rejette un quota négatif en le nommant', () => {
    expect(() =>
      calculerSuiviUa({ ...ENGAGEMENT, quotaHeures: -1 }, [], AUJOURDHUI),
    ).toThrow(QuantiteInvalideError);
    expect(() =>
      calculerSuiviUa({ ...ENGAGEMENT, quotaHeures: -1 }, [], AUJOURDHUI),
    ).toThrow('quotaHeures');
  });

  it('rejette une durée de session négative en la nommant', () => {
    expect(() =>
      calculerSuiviUa(
        ENGAGEMENT,
        [session('2026-09-12', -2, 'REALISEE')],
        AUJOURDHUI,
      ),
    ).toThrow('dureeHeures');
  });
});

describe('joursEntre — bornes UTC', () => {
  it('ignore le fuseau : une date nue reste la même à minuit UTC', () => {
    expect(joursEntre('2026-06-01', '2027-05-31')).toBe(364);
    expect(joursEntre('2027-05-31', '2026-06-01')).toBe(-364);
    expect(joursEntre('2026-06-01', '2026-06-01')).toBe(0);
  });

  it('traverse un passage à l’heure d’été sans perdre de jour', () => {
    // 2027-03-28 : changement d'heure en Europe/Paris.
    expect(joursEntre('2027-03-27', '2027-03-29')).toBe(2);
  });
});

describe('catalogues (SFD 40 §3, principe 2)', () => {
  it('expose les trois états et les six types comme des données', () => {
    expect(ETATS_SESSION_UA).toEqual(['PREVUE', 'REALISEE', 'ANNULEE']);
    expect(TYPES_SESSION_UA).toContain('MENAGE');
    expect(TYPES_SESSION_UA).toContain('CVE');
    expect(TYPES_SESSION_UA).toContain('TALENT');
    expect(TYPES_SESSION_UA).toHaveLength(6);
  });
});
