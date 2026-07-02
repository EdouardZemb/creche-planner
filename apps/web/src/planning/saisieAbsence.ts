import type { PlageHoraire, SemaineTypeCreche } from '../types/bff';
import { jourSemaineDeIso } from '../utils/dates';
import { classerAbsence } from './etatJourGarde';
import {
  minutesDeHhmm,
  plageDepuisHeures,
  plageValide,
  versHhmm,
} from './heures';

// Logique de saisie d'une absence crèche : dérivation de la fenêtre d'absence
// stockée depuis le type d'ajustement saisi, et aller-retour inverse pour
// rouvrir la modale. Module pur, sans état ni dépendance UI (modèle :
// `etatJourGarde.ts`), extrait de `CalendrierCreche` pour être testable
// isolément.

// Type d'ajustement saisi : décrit la PRÉSENCE de l'enfant. La fenêtre d'absence
// stockée (durée = fin − début) en est dérivée — l'utilisateur ne saisit plus
// directement la fenêtre, ce qui levait l'ambiguïté « départ à 16h » → 8h déduites.
export type TypeAbsence =
  | 'journee'
  | 'departAvance'
  | 'arriveeRetardee'
  | 'personnalise';

// Heures saisies : `heure` pour les types à un seul champ (départ avancé /
// arrivée retardée), `arrivee`/`depart` pour la fenêtre libre « personnalisé ».
export interface SaisieHeures {
  arrivee: string;
  depart: string;
  heure: string;
}

// Options (et ordre) du sélecteur de type d'absence, partagées modale ↔ lot.
export const TYPES_ABSENCE: readonly {
  valeur: TypeAbsence;
  libelle: string;
}[] = [
  { valeur: 'journee', libelle: 'Absence toute la journée' },
  { valeur: 'departAvance', libelle: 'Départ avancé' },
  { valeur: 'arriveeRetardee', libelle: 'Arrivée retardée' },
  { valeur: 'personnalise', libelle: 'Absence personnalisée' },
];

/** Plage de garde d'un jour (arrivée/départ `HH:MM`), telle que saisie. */
export interface PlageGarde {
  arrivee: string;
  depart: string;
}

/**
 * Plage de garde du contrat pour un jour (arrivée du 1er créneau → départ du
 * dernier), pour pré-remplir une absence pleine journée. `null` si non gardé.
 */
export function plageGardeDuJour(
  semaineType: SemaineTypeCreche | undefined,
  iso: string,
): PlageGarde | null {
  const plages = semaineType?.[jourSemaineDeIso(iso)] ?? [];
  const premier = plages[0];
  const dernier = plages[plages.length - 1];
  if (!premier || !dernier) return null;
  return {
    arrivee: versHhmm(premier.debutHeures, premier.debutMinutes),
    depart: versHhmm(dernier.finHeures, dernier.finMinutes),
  };
}

/**
 * Dérive la FENÊTRE D'ABSENCE (`PlageHoraire`, durée = fin − début) à stocker,
 * depuis le type d'ajustement (qui décrit la présence) et la plage de garde du
 * jour (`garde`, A = arrivée / D = départ). `null` si la saisie est incohérente
 * (heure hors garde, plage personnalisée invalide, jour non gardé) → à ignorer.
 *
 * - `journee` → toute la garde [A, D].
 * - `departAvance` (présent jusqu'à `h`) → [h, D], avec A < h < D.
 * - `arriveeRetardee` (présent à partir de `h`) → [A, h], avec A < h < D.
 * - `personnalise` → fenêtre libre [arrivee, depart], si cohérente.
 */
export function fenetreAbsence(
  type: TypeAbsence,
  saisie: SaisieHeures,
  garde: PlageGarde | null,
): PlageHoraire | null {
  if (type === 'personnalise') {
    return plageValide(saisie.arrivee, saisie.depart)
      ? plageDepuisHeures(saisie.arrivee, saisie.depart)
      : null;
  }
  if (garde === null) return null;
  if (type === 'journee') {
    return plageDepuisHeures(garde.arrivee, garde.depart);
  }
  const a = minutesDeHhmm(garde.arrivee);
  const d = minutesDeHhmm(garde.depart);
  const h = minutesDeHhmm(saisie.heure);
  if (saisie.heure === '' || h <= a || h >= d) return null;
  return type === 'departAvance'
    ? plageDepuisHeures(saisie.heure, garde.depart)
    : plageDepuisHeures(garde.arrivee, saisie.heure);
}

/**
 * Validité d'une saisie INDÉPENDAMMENT du jour (pour activer un bouton de lot,
 * où chaque jour porte sa propre garde). La cohérence avec la garde de chaque
 * jour est vérifiée à l'application, via `fenetreAbsence`.
 */
export function saisieAbsenceValide(
  type: TypeAbsence,
  saisie: SaisieHeures,
): boolean {
  if (type === 'journee') return true;
  if (type === 'personnalise') {
    return plageValide(saisie.arrivee, saisie.depart);
  }
  return saisie.heure !== '';
}

/**
 * Reconstruit le type d'ajustement (et son heure pivot) depuis la fenêtre
 * d'absence stockée, pour un aller-retour fidèle dans la modale : la fenêtre
 * d'absence redevient une présence saisie. Inverse de `fenetreAbsence` —
 * `personnalise` (fenêtre libre) quand aucun type dédié ne correspond.
 */
export function typeAbsenceDepuisFenetre(
  absence: PlageHoraire,
  garde: PlageGarde | null,
): { typeAbsence: TypeAbsence; heure: string } {
  const classe = classerAbsence(absence, garde);
  if (classe.statut === 'absent') {
    return { typeAbsence: 'journee', heure: '' };
  }
  if (classe.libelle === 'Départ avancé') {
    return {
      typeAbsence: 'departAvance',
      heure: versHhmm(absence.debutHeures, absence.debutMinutes),
    };
  }
  if (classe.libelle === 'Arrivée retardée') {
    return {
      typeAbsence: 'arriveeRetardee',
      heure: versHhmm(absence.finHeures, absence.finMinutes),
    };
  }
  return { typeAbsence: 'personnalise', heure: '' };
}
