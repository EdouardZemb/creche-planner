import { Duree } from '@creche-planner/shared-kernel';
import type { JourSemaine } from './jour-semaine.js';
import { PlageHoraire } from './plage-horaire.js';

/** Saisie d'une semaine type : jour de la semaine → plage(s) horaire(s). */
export type SaisieSemaineType = Partial<Record<JourSemaine, PlageHoraire[]>>;

/** Ordre canonique des jours pour l'énumération déterministe. */
const ORDRE_JOURS: readonly JourSemaine[] = [
  'LUNDI',
  'MARDI',
  'MERCREDI',
  'JEUDI',
  'VENDREDI',
  'SAMEDI',
  'DIMANCHE',
];

/**
 * Semaine type de garde (doc 02 §7) : associe à chaque jour de la semaine une ou
 * plusieurs plages horaires. Sert à dériver les quantités du mois (durée crèche,
 * jours/séances ABCM). Immuable.
 */
export class SemaineType {
  private constructor(
    private readonly plagesParJour: ReadonlyMap<JourSemaine, PlageHoraire[]>,
  ) {}

  static creer(saisie: SaisieSemaineType): SemaineType {
    const plages = new Map<JourSemaine, PlageHoraire[]>();
    for (const jour of ORDRE_JOURS) {
      const plagesJour = saisie[jour];
      if (plagesJour !== undefined && plagesJour.length > 0) {
        plages.set(jour, [...plagesJour]);
      }
    }
    return new SemaineType(plages);
  }

  /** Durée gardée un jour donné (somme des plages ; nulle si non gardé). */
  dureeJour(jour: JourSemaine): Duree {
    const plages = this.plagesParJour.get(jour);
    if (plages === undefined) {
      return Duree.zero();
    }
    return plages.reduce(
      (total, plage) => total.plus(plage.duree),
      Duree.zero(),
    );
  }

  /** Vrai si au moins une plage est définie ce jour-là. */
  estGarde(jour: JourSemaine): boolean {
    return this.plagesParJour.has(jour);
  }

  /** Jours gardés, dans l'ordre canonique lundi → dimanche. */
  get joursGardes(): JourSemaine[] {
    return ORDRE_JOURS.filter((jour) => this.plagesParJour.has(jour));
  }

  /** Durée totale gardée sur la semaine. */
  get dureeHebdomadaire(): Duree {
    return this.joursGardes.reduce(
      (total, jour) => total.plus(this.dureeJour(jour)),
      Duree.zero(),
    );
  }
}
