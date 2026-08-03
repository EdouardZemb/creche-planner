import type { ContratBesoinsSemaine, ExceptionAbcm } from '../types/bff';
import { jourSemaineDeIso } from '../utils/dates';
import { classerAjustement } from '../planning/etatJourGarde';
import { formaterPlage, versHhmm } from '../planning/heures';
import {
  alshEffectif,
  libelleAlsh,
  type AjustementEtat,
  type AlshEtat,
  type AbsenceEtat,
  type BesoinsEtat,
  type JourSupEtat,
} from './besoinsSemaine';

/**
 * Besoins de la semaine indexés PAR DATE. Les rangées de jours interrogent ces
 * cinq index à chaque rendu (résumé, présence d'une saisie, préremplissage de
 * la modale) : les reconstruire par balayage de liste à chaque appel ferait du
 * quadratique sur une structure qui ne change qu'à l'enregistrement.
 */
export interface IndexBesoins {
  readonly absences: ReadonlyMap<string, AbsenceEtat>;
  readonly joursSup: ReadonlyMap<string, JourSupEtat>;
  readonly ajustements: ReadonlyMap<string, AjustementEtat>;
  readonly exceptions: ReadonlyMap<string, ExceptionAbcm>;
  readonly joursAlsh: ReadonlyMap<string, AlshEtat>;
}

export function indexerBesoins(besoins: BesoinsEtat): IndexBesoins {
  return {
    absences: new Map(besoins.absences.map((a) => [a.date, a])),
    joursSup: new Map(besoins.joursSup.map((j) => [j.date, j])),
    ajustements: new Map(besoins.ajustements.map((a) => [a.date, a])),
    exceptions: new Map(besoins.exceptions.map((e) => [e.date, e])),
    joursAlsh: new Map(besoins.joursAlsh.map((j) => [j.date, j])),
  };
}

/**
 * Plage de garde contractuelle (1re plage de la semaine-type) d'un jour crèche,
 * ou `null` si le jour n'est pas gardé. Sert à la fois de repère « jour gardé »
 * et de préremplissage des heures réelles.
 */
export function plageContratPremiere(
  contrat: ContratBesoinsSemaine,
  date: string,
): { arrivee: string; depart: string } | null {
  const base = contrat.semaineType?.[jourSemaineDeIso(date)]?.[0];
  if (base === undefined) return null;
  return {
    arrivee: versHhmm(base.debutHeures, base.debutMinutes),
    depart: versHhmm(base.finHeures, base.finMinutes),
  };
}

/** Vrai si une saisie datée existe ce jour (→ « Modifier » et « Supprimer »). */
export function aSaisieJour(
  contrat: ContratBesoinsSemaine,
  index: IndexBesoins,
  date: string,
): boolean {
  if (contrat.mode === 'CRECHE_PSU') {
    return (
      index.absences.has(date) ||
      index.joursSup.has(date) ||
      index.ajustements.has(date)
    );
  }
  if (contrat.mode === 'ALSH') {
    // « Modifier » dès qu'un jour est réservé effectivement (explicite ou
    // récurrence active) → la modale propose alors « Supprimer ».
    return (
      alshEffectif(
        date,
        index.joursAlsh.get(date),
        index.exceptions.get(date),
        contrat.semaineAbcm,
      ) !== null
    );
  }
  return index.exceptions.has(date);
}

/**
 * Horaire EFFECTIF du jour, sans ouvrir la saisie : une entrée datée
 * (ajustement / absence / jour ajouté) prime ; à défaut on retombe sur le
 * planning de BASE du contrat pour ce jour de semaine ; sinon « — ».
 */
export function resumeJour(
  contrat: ContratBesoinsSemaine,
  index: IndexBesoins,
  date: string,
): string {
  const jour = jourSemaineDeIso(date);
  if (contrat.mode === 'CRECHE_PSU') {
    const aj = index.ajustements.get(date);
    if (aj) {
      const classe = classerAjustement(aj, plageContratPremiere(contrat, date));
      return `${classe.libelle} ${classe.presence}`;
    }
    const abs = index.absences.get(date);
    if (abs) return `Absent (${formaterPlage(abs)})`;
    const sup = index.joursSup.get(date);
    if (sup) return `Jour ajouté (${formaterPlage(sup)})`;
    const base = contrat.semaineType?.[jour];
    if (base && base.length > 0) {
      return `Gardé ${base.map(formaterPlage).join(', ')}`;
    }
    return '—';
  }
  if (contrat.mode === 'ALSH') {
    const j = alshEffectif(
      date,
      index.joursAlsh.get(date),
      index.exceptions.get(date),
      contrat.semaineAbcm,
    );
    return j ? libelleAlsh(j) : '—';
  }
  const e = index.exceptions.get(date);
  const base = contrat.semaineAbcm?.[jour];
  if (contrat.mode === 'CANTINE') {
    if (e) return e.cantine ? 'Cantine' : 'Sans cantine';
    return base?.cantine ? 'Cantine' : '—';
  }
  const matin = e ? (e.periMatin ?? false) : (base?.periMatin ?? false);
  const soir = e ? (e.periSoir ?? false) : (base?.periSoir ?? false);
  const parts: string[] = [];
  if (matin) parts.push('matin');
  if (soir) parts.push('soir');
  if (parts.length > 0) return `Péri ${parts.join(' + ')}`;
  return e ? 'Sans péri' : '—';
}
