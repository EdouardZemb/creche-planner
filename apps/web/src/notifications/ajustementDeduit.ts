import { minutesDeHhmm } from '../planning/heures';

// Lecture, en mots de parent, de l'écart entre la présence RÉELLE saisie sur un
// jour gardé et la plage de garde contractuelle. Module pur, sans état ni
// dépendance UI : il alimente à la fois la ligne d'annonce de la modale et la
// décision d'enregistrement (une saisie identique au contrat ne s'écrit pas).

/** Durée lisible d'un écart d'horaire : « 45 min », « 1 h », « 1 h 30 ». */
export function formaterDuree(minutes: number): string {
  const heures = Math.floor(minutes / 60);
  const reste = minutes % 60;
  if (heures === 0) return `${reste} min`;
  if (reste === 0) return `${heures} h`;
  return `${heures} h ${reste}`;
}

/** État déduit d'une plage de présence réelle au regard de la plage de contrat. */
export interface EtatDeduit {
  /** Une réduction (candidate à déduction) est présente → poser préavis/certificat. */
  readonly reductionPresente: boolean;
  /** L'entrée est sans effet (présence = plage de contrat) → rien à enregistrer. */
  readonly identique: boolean;
  /** Message annoncé sous les champs (aria-live), au mot près. */
  readonly message: string;
}

/**
 * Décrit l'écart entre la présence réelle saisie et la plage de garde
 * contractuelle du jour : **extension** (minutes hors plage → facturées en
 * complément), **réduction** (minutes de la plage non couvertes → candidate à
 * déduction), les deux, ou rien. Durées comparées en minutes depuis minuit ;
 * libellés au mot près (plan Lot 2b).
 */
export function etatDeduitAjustement(
  arrivee: string,
  depart: string,
  base: { arrivee: string; depart: string },
): EtatDeduit {
  const arriveeContrat = minutesDeHhmm(base.arrivee);
  const departContrat = minutesDeHhmm(base.depart);
  const arriveeReelle = minutesDeHhmm(arrivee);
  const departReel = minutesDeHhmm(depart);
  const extension =
    Math.max(0, arriveeContrat - arriveeReelle) +
    Math.max(0, departReel - departContrat);
  const reduction =
    Math.max(0, arriveeReelle - arriveeContrat) +
    Math.max(0, departContrat - departReel);
  const habituel = `${base.arrivee}–${base.depart}`;

  if (extension > 0 && reduction > 0) {
    return {
      reductionPresente: true,
      identique: false,
      message: `Horaires ajustés (${habituel} habituellement) : ${formaterDuree(
        extension,
      )} en plus (facturés en complément), ${formaterDuree(reduction)} en moins.`,
    };
  }
  if (extension > 0) {
    return {
      reductionPresente: false,
      identique: false,
      message: `${formaterDuree(
        extension,
      )} de plus que les horaires habituels (${habituel}) — facturé en complément.`,
    };
  }
  if (reduction > 0) {
    return {
      reductionPresente: true,
      identique: false,
      message: `${formaterDuree(
        reduction,
      )} de moins que les horaires habituels (${habituel}).`,
    };
  }
  return {
    reductionPresente: false,
    identique: true,
    message: 'Horaires habituels — rien à enregistrer.',
  };
}
