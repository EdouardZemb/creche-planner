import { Money } from '@creche-planner/shared-kernel';

/**
 * Sens d'une ligne de coût : un `debit` augmente la facture, un `credit`
 * (déduction d'absence PSU, par ex.) la diminue.
 */
export type SensLigne = 'debit' | 'credit';

/**
 * Ligne de coût atomique (doc 02 §1) : base, complément, déduction, séance,
 * repas, journée, frais… Le montant est un `Money` déjà arrondi au centime
 * (doc 02 §2 : « arrondi au centime, par ligne de coût, puis somme »).
 */
export class LigneDeCout {
  private constructor(
    readonly libelle: string,
    readonly montant: Money,
    readonly sens: SensLigne,
  ) {}

  static debit(libelle: string, montant: Money): LigneDeCout {
    return new LigneDeCout(libelle, montant, 'debit');
  }

  static credit(libelle: string, montant: Money): LigneDeCout {
    return new LigneDeCout(libelle, montant, 'credit');
  }

  estCredit(): boolean {
    return this.sens === 'credit';
  }
}

/**
 * Coût d'un mois : un agrégat ordonné de lignes. Le total se calcule en
 * sommant d'abord les débits puis les crédits et en soustrayant une seule fois
 * — l'ordre des lignes n'influe donc pas, et un total négatif (crédits >
 * débits) lève via `Money.moins` (INV-06 : coût mensuel ≥ 0).
 */
export class CoutMois {
  constructor(readonly lignes: readonly LigneDeCout[]) {}

  get total(): Money {
    let debits = Money.zero();
    let credits = Money.zero();
    for (const ligne of this.lignes) {
      if (ligne.estCredit()) {
        credits = credits.plus(ligne.montant);
      } else {
        debits = debits.plus(ligne.montant);
      }
    }
    return debits.moins(credits);
  }

  estVide(): boolean {
    return this.lignes.length === 0;
  }
}
