import {
  DureeInvalideError,
  PlageHoraireInvalideError,
} from './domain-error.js';

/**
 * Durée immuable en **minutes entières** et toujours ≥ 0 (doc 02 §2, INV-01).
 * Jamais de flottant d'heure : les conversions en heures décimales sont des
 * vues de lecture, pas l'état interne.
 */
export class Duree {
  private constructor(private readonly _minutes: number) {}

  static depuisMinutes(minutes: number): Duree {
    if (!Number.isInteger(minutes)) {
      throw new DureeInvalideError(`durée en minutes non entière : ${minutes}`);
    }
    if (minutes < 0) {
      throw new DureeInvalideError(`durée négative : ${minutes} minute(s)`);
    }
    return new Duree(minutes);
  }

  static depuisHeuresMinutes(heures: number, minutes: number): Duree {
    return Duree.depuisMinutes(heures * 60 + minutes);
  }

  /**
   * Durée entre deux instants d'une même journée (minutes depuis minuit).
   * La fin doit être strictement postérieure au début (INV-01).
   */
  static entre(debutMinutes: number, finMinutes: number): Duree {
    if (finMinutes <= debutMinutes) {
      throw new PlageHoraireInvalideError(
        `la fin (${finMinutes}) doit être strictement postérieure au début (${debutMinutes})`,
      );
    }
    return Duree.depuisMinutes(finMinutes - debutMinutes);
  }

  static zero(): Duree {
    return new Duree(0);
  }

  get enMinutes(): number {
    return this._minutes;
  }

  plus(autre: Duree): Duree {
    return Duree.depuisMinutes(this._minutes + autre._minutes);
  }

  moins(autre: Duree): Duree {
    return Duree.depuisMinutes(this._minutes - autre._minutes);
  }

  enHeures(): number {
    return this._minutes / 60;
  }

  egale(autre: Duree): boolean {
    return this._minutes === autre._minutes;
  }

  estZero(): boolean {
    return this._minutes === 0;
  }

  toString(): string {
    const heures = Math.trunc(this._minutes / 60);
    const minutes = (this._minutes % 60).toString().padStart(2, '0');
    return `${heures} h ${minutes}`;
  }
}
