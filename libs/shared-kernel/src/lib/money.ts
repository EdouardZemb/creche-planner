import { MontantNegatifError, MontantNonEntierError } from './domain-error.js';

/**
 * Montant monétaire immuable, stocké en **centimes entiers** et toujours ≥ 0
 * (doc 02 §2, doc 03 §3). Aucune opération ne manipule de flottant d'euro :
 * l'arrondi au centime est fait à la frontière (construction / multiplication).
 */
export class Money {
  private constructor(private readonly _centimes: number) {}

  static depuisCentimes(centimes: number): Money {
    if (!Number.isInteger(centimes)) {
      throw new MontantNonEntierError(
        `montant en centimes non entier : ${centimes}`,
      );
    }
    if (centimes < 0) {
      throw new MontantNegatifError(`montant négatif : ${centimes} centime(s)`);
    }
    return new Money(centimes);
  }

  /** Convertit des euros en centimes en arrondissant au centime le plus proche. */
  static depuisEuros(euros: number): Money {
    // toFixed(4) absorbe le bruit binaire (ex. 3.47 * 100 = 347.00000000000006)
    // avant l'arrondi au centime.
    const centimes = Math.round(Number((euros * 100).toFixed(4)));
    return Money.depuisCentimes(centimes);
  }

  static zero(): Money {
    return new Money(0);
  }

  get centimes(): number {
    return this._centimes;
  }

  plus(autre: Money): Money {
    return Money.depuisCentimes(this._centimes + autre._centimes);
  }

  moins(autre: Money): Money {
    return Money.depuisCentimes(this._centimes - autre._centimes);
  }

  /** Multiplie par une quantité (heures, séances, jours…) avec arrondi au centime. */
  fois(facteur: number): Money {
    return Money.depuisCentimes(Math.round(this._centimes * facteur));
  }

  egale(autre: Money): boolean {
    return this._centimes === autre._centimes;
  }

  estZero(): boolean {
    return this._centimes === 0;
  }

  estSuperieurA(autre: Money): boolean {
    return this._centimes > autre._centimes;
  }

  enEuros(): number {
    return this._centimes / 100;
  }

  toString(): string {
    const euros = Math.trunc(this._centimes / 100);
    const centimes = (this._centimes % 100).toString().padStart(2, '0');
    return `${euros},${centimes} €`;
  }
}
