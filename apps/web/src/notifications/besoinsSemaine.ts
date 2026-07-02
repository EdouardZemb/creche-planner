import type {
  AbsenceCreche,
  ContratBesoinsSemaine,
  EcrireSemaineBesoins,
  ExceptionAbcm,
  JourAlsh,
  JourSupplementaire,
  PlageHoraire,
} from '../types/bff';

// Logique pure de l'éditeur hebdomadaire (`EditeurContratSemaine`) : aplatir les
// besoins datés du contrat en état d'édition par catégorie, et reconstruire le
// corps d'écriture `PUT .../plannings/semaine:{semaineIso}` depuis cet état.
// Extraite du composant pour être testable sans rendu.

export interface AbsenceEtat extends PlageHoraire {
  date: string;
  preavisJours: number;
  certificatMaladie: boolean;
}

export interface JourSupEtat extends PlageHoraire {
  date: string;
}

export interface AlshEtat {
  date: string;
  type: 'COMPLETE' | 'DEMI';
  repas: boolean;
}

export interface BesoinsEtat {
  absences: AbsenceEtat[];
  joursSup: JourSupEtat[];
  exceptions: ExceptionAbcm[];
  joursAlsh: AlshEtat[];
}

/** Aplati les besoins datés de la semaine (par jour) en listes par catégorie. */
export function initBesoins(contrat: ContratBesoinsSemaine): BesoinsEtat {
  const absences: AbsenceEtat[] = [];
  const joursSup: JourSupEtat[] = [];
  const exceptions: ExceptionAbcm[] = [];
  const joursAlsh: AlshEtat[] = [];
  for (const jour of Object.values(contrat.besoins)) {
    for (const a of jour.absences) {
      if (a.date === undefined) continue;
      absences.push({
        date: a.date,
        debutHeures: a.debutHeures,
        debutMinutes: a.debutMinutes,
        finHeures: a.finHeures,
        finMinutes: a.finMinutes,
        preavisJours: a.preavisJours,
        certificatMaladie: a.certificatMaladie,
      });
    }
    for (const j of jour.joursSupplementaires) {
      joursSup.push({
        date: j.date,
        debutHeures: j.debutHeures,
        debutMinutes: j.debutMinutes,
        finHeures: j.finHeures,
        finMinutes: j.finMinutes,
      });
    }
    exceptions.push(...jour.exceptions);
    for (const j of jour.joursAlsh) {
      joursAlsh.push({ date: j.date, type: j.type, repas: j.repas ?? false });
    }
  }
  return { absences, joursSup, exceptions, joursAlsh };
}

/** Corps d'écriture (catégories datées non vides) depuis l'état d'édition. */
export function versCorps(etat: BesoinsEtat): EcrireSemaineBesoins {
  const absences: AbsenceCreche[] = etat.absences.map((a) => ({
    date: a.date,
    debutHeures: a.debutHeures,
    debutMinutes: a.debutMinutes,
    finHeures: a.finHeures,
    finMinutes: a.finMinutes,
    preavisJours: a.preavisJours,
    certificatMaladie: a.certificatMaladie,
  }));
  const joursSupplementaires: JourSupplementaire[] = etat.joursSup.map((j) => ({
    date: j.date,
    debutHeures: j.debutHeures,
    debutMinutes: j.debutMinutes,
    finHeures: j.finHeures,
    finMinutes: j.finMinutes,
  }));
  const joursAlsh: JourAlsh[] = etat.joursAlsh.map((j) => ({
    date: j.date,
    type: j.type,
    ...(j.repas ? { repas: j.repas } : {}),
  }));
  return {
    ...(joursSupplementaires.length > 0 ? { joursSupplementaires } : {}),
    ...(absences.length > 0 ? { absences } : {}),
    ...(etat.exceptions.length > 0 ? { exceptions: etat.exceptions } : {}),
    ...(joursAlsh.length > 0 ? { joursAlsh } : {}),
  };
}
