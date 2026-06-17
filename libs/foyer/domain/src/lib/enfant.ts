import {
  DateNaissanceInvalideError,
  PrenomInvalideError,
} from './foyer-error.js';

/** Saisie brute d'un enfant avant validation. */
export interface SaisieEnfant {
  readonly prenom: string;
  readonly dateNaissance: Date;
}

/**
 * Enfant rattaché à un foyer (doc 02 §1). Value object immuable : prénom non
 * vide + date de naissance valide. La date est stockée en epoch ms et exposée
 * par copie défensive pour rester réellement immuable.
 */
export class Enfant {
  private constructor(
    readonly prenom: string,
    private readonly _naissanceMs: number,
  ) {}

  static creer(saisie: SaisieEnfant): Enfant {
    const prenom = saisie.prenom.trim();
    if (prenom.length === 0) {
      throw new PrenomInvalideError('le prénom de l’enfant est obligatoire');
    }
    const naissanceMs = saisie.dateNaissance.getTime();
    if (Number.isNaN(naissanceMs)) {
      throw new DateNaissanceInvalideError(
        `date de naissance invalide pour « ${prenom} »`,
      );
    }
    return new Enfant(prenom, naissanceMs);
  }

  get dateNaissance(): Date {
    return new Date(this._naissanceMs);
  }

  egale(autre: Enfant): boolean {
    return (
      this.prenom === autre.prenom && this._naissanceMs === autre._naissanceMs
    );
  }

  toString(): string {
    return `${this.prenom} (${this.dateNaissance.toISOString().slice(0, 10)})`;
  }
}
