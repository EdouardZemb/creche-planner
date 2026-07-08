import type {
  AbsenceCreche,
  AjustementJour,
  ContratBesoinsSemaine,
  EcrireSemaineBesoins,
  ExceptionAbcm,
  JourAlsh,
  JourAlshHebdo,
  JourSupplementaire,
  PlageHoraire,
  SemaineAbcm,
} from '../types/bff';
import { jourSemaineDeIso } from '../utils/dates';

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

/** Heures réelles d'un jour gardé (présence saisie) → catégorie `ajustements`. */
export interface AjustementEtat extends PlageHoraire {
  date: string;
  preavisJours: number;
  certificatMaladie: boolean;
}

export interface AlshEtat {
  date: string;
  type: 'COMPLETE' | 'DEMI';
  repas: boolean;
}

export interface BesoinsEtat {
  absences: AbsenceEtat[];
  joursSup: JourSupEtat[];
  ajustements: AjustementEtat[];
  exceptions: ExceptionAbcm[];
  joursAlsh: AlshEtat[];
}

/** Aplati les besoins datés de la semaine (par jour) en listes par catégorie. */
export function initBesoins(contrat: ContratBesoinsSemaine): BesoinsEtat {
  const absences: AbsenceEtat[] = [];
  const joursSup: JourSupEtat[] = [];
  const ajustements: AjustementEtat[] = [];
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
    for (const a of jour.ajustements) {
      ajustements.push({
        date: a.date,
        debutHeures: a.debutHeures,
        debutMinutes: a.debutMinutes,
        finHeures: a.finHeures,
        finMinutes: a.finMinutes,
        preavisJours: a.preavisJours,
        certificatMaladie: a.certificatMaladie,
      });
    }
    exceptions.push(...jour.exceptions);
    for (const j of jour.joursAlsh) {
      joursAlsh.push({ date: j.date, type: j.type, repas: j.repas ?? false });
    }
  }
  return { absences, joursSup, ajustements, exceptions, joursAlsh };
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
  const ajustements: AjustementJour[] = etat.ajustements.map((a) => ({
    date: a.date,
    debutHeures: a.debutHeures,
    debutMinutes: a.debutMinutes,
    finHeures: a.finHeures,
    finMinutes: a.finMinutes,
    preavisJours: a.preavisJours,
    certificatMaladie: a.certificatMaladie,
  }));
  const joursAlsh: JourAlsh[] = etat.joursAlsh.map((j) => ({
    date: j.date,
    type: j.type,
    ...(j.repas ? { repas: j.repas } : {}),
  }));
  return {
    ...(joursSupplementaires.length > 0 ? { joursSupplementaires } : {}),
    ...(absences.length > 0 ? { absences } : {}),
    ...(ajustements.length > 0 ? { ajustements } : {}),
    ...(etat.exceptions.length > 0 ? { exceptions: etat.exceptions } : {}),
    ...(joursAlsh.length > 0 ? { joursAlsh } : {}),
  };
}

/**
 * Jour ALSH **effectif** pour une date `YYYY-MM-DD` d'un contrat mode ALSH,
 * miroir de `dashboard/jourFoyer.ts` → `ligneAbcm` (branche ALSH) : un jour
 * explicite daté prime ; sinon la récurrence hebdomadaire (`semaineAbcm[jour].alsh`)
 * ajustée par l'exception datée (`alsh:false` retire, `alsh:true` (ré)active, la
 * config par défaut étant celle de la semaine-type ou `{ type: 'COMPLETE' }`).
 * `null` si le jour n'est finalement pas réservé.
 */
export function alshEffectif(
  date: string,
  explicite: JourAlshHebdo | undefined,
  exception: ExceptionAbcm | undefined,
  semaineAbcm: SemaineAbcm | undefined,
): JourAlshHebdo | null {
  if (explicite) {
    return explicite;
  }
  const base = semaineAbcm?.[jourSemaineDeIso(date)]?.alsh;
  if (exception?.alsh !== undefined) {
    if (!exception.alsh) {
      return null;
    }
    return base ?? { type: 'COMPLETE' };
  }
  return base ?? null;
}

/** Libellé lisible d'un jour ALSH effectif (`Journée`, `Journée + repas`, `Demi-journée`). */
export function libelleAlsh(jour: JourAlshHebdo): string {
  if (jour.type === 'DEMI') {
    return 'Demi-journée';
  }
  return jour.repas ? 'Journée + repas' : 'Journée';
}
