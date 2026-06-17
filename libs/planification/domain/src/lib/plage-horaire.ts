import { Duree } from '@creche-planner/shared-kernel';

/**
 * Plage horaire d'une journée (doc 02 §7), exprimée en minutes depuis minuit.
 * Immuable ; la fin doit être strictement postérieure au début (INV-01, garanti
 * par `Duree.entre`). La durée est dérivée du `shared-kernel`, jamais redéfinie.
 */
export class PlageHoraire {
  private constructor(
    readonly debutMinutes: number,
    readonly finMinutes: number,
    readonly duree: Duree,
  ) {}

  /** Crée une plage depuis heures/minutes de début et de fin. */
  static creer(
    debutHeures: number,
    debutMinutes: number,
    finHeures: number,
    finMinutes: number,
  ): PlageHoraire {
    const debut = debutHeures * 60 + debutMinutes;
    const fin = finHeures * 60 + finMinutes;
    // `Duree.entre` impose fin > début (INV-01).
    const duree = Duree.entre(debut, fin);
    return new PlageHoraire(debut, fin, duree);
  }
}
