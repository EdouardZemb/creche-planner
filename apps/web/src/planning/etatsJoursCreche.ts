import type { EventInput } from '@fullcalendar/core';
import type { SemaineTypeCreche } from '../types/bff';
import { joursDuMois, jourSemaineDeIso } from '../utils/dates';
import { classerAbsence, classerAjustement } from './etatJourGarde';
import { evenementJour } from './evenementJour';
import type { PlageGarde } from './saisieAbsence';
import type {
  EtatAbsence,
  EtatAjustement,
  EtatJourSup,
} from './useSaisieCreche';

/** Palette du calendrier crèche, résolue une fois par rendu. */
export interface CouleursCreche {
  /** Jour gardé conforme au contrat (couleur du mode). */
  garde: string;
  /** Absence pleine journée. */
  absent: string;
  /** Présence partielle : absence partielle ou ajustement d'heures réelles. */
  ajustement: string;
  /** Jour de garde ajouté hors contrat. */
  ajoute: string;
}

/**
 * État d'affichage d'un jour gardé, classé UNE seule fois (couleur + libellés)
 * pour être partagé par la pastille du calendrier et la liste clavier — sans
 * quoi les deux pourraient diverger.
 */
export interface EtatJourAffiche {
  /** Une absence est saisie ce jour (→ « Modifier » plutôt que « Saisir »). */
  readonly aAbsence: boolean;
  /** Couleur de la pastille FullCalendar. */
  readonly couleur: string;
  /** Titre de l'évènement FullCalendar. */
  readonly titre: string;
  /** Libellé d'état affiché dans la liste clavier. */
  readonly libelle: string;
}

/** Jours du mois effectivement gardés par le contrat, dans sa période. */
export function joursGardesDuMois(
  mois: string,
  semaineType: SemaineTypeCreche,
  estDansPeriode: (iso: string) => boolean,
): Set<string> {
  const gardes = new Set<string>();
  for (const jour of joursDuMois(mois)) {
    if (!estDansPeriode(jour)) continue;
    if ((semaineType[jourSemaineDeIso(jour)]?.length ?? 0) > 0) {
      gardes.add(jour);
    }
  }
  return gardes;
}

/**
 * Classe chaque jour gardé : « Gardé » sans saisie ; avec absence,
 * `classerAbsence` distingue l'absence pleine journée (rouge) de la simple
 * présence partielle (ambre) ; un ajustement d'heures réelles (posé dans
 * l'éditeur hebdomadaire, non éditable ici) s'affiche en ambre avec la présence.
 */
export function etatsJoursGardes(
  joursGardes: ReadonlySet<string>,
  absences: readonly EtatAbsence[],
  ajustements: readonly EtatAjustement[],
  plageContratJour: (iso: string) => PlageGarde | null,
  couleurs: CouleursCreche,
): Map<string, EtatJourAffiche> {
  const map = new Map<string, EtatJourAffiche>();
  for (const jour of joursGardes) {
    const absence = absences.find((a) => a.date === jour);
    if (absence === undefined) {
      const ajustement = ajustements.find((a) => a.date === jour);
      if (ajustement) {
        const classe = classerAjustement(ajustement, plageContratJour(jour));
        map.set(jour, {
          aAbsence: false,
          couleur: couleurs.ajustement,
          titre: `${classe.libelle} (présent ${classe.presence})`,
          libelle: `${classe.libelle} · ${classe.presence}`,
        });
        continue;
      }
      map.set(jour, {
        aAbsence: false,
        couleur: couleurs.garde,
        titre: 'Gardé',
        libelle: 'Gardé',
      });
      continue;
    }
    const classe = classerAbsence(absence, plageContratJour(jour));
    if (classe.statut === 'absent') {
      map.set(jour, {
        aAbsence: true,
        couleur: couleurs.absent,
        titre: 'Absent',
        libelle: 'Absent',
      });
    } else {
      map.set(jour, {
        aAbsence: true,
        couleur: couleurs.ajustement,
        titre: classe.presence
          ? `${classe.libelle} (présent ${classe.presence})`
          : classe.libelle,
        libelle: classe.presence
          ? `${classe.libelle} · ${classe.presence}`
          : classe.libelle,
      });
    }
  }
  return map;
}

/**
 * Pastilles du mois : un jour gardé et un jour ajouté peuvent porter la MÊME
 * date (un jour ajouté hors contrat n'est jamais gardé, mais l'identifiant les
 * distingue explicitement plutôt que par construction).
 */
export function evenementsCreche(
  joursGardes: ReadonlySet<string>,
  joursSup: readonly EtatJourSup[],
  etatsJours: ReadonlyMap<string, EtatJourAffiche>,
  couleurs: CouleursCreche,
): EventInput[] {
  const evts: EventInput[] = [];
  for (const jour of joursGardes) {
    const etat = etatsJours.get(jour);
    evts.push(
      evenementJour(
        jour,
        jour,
        etat?.couleur ?? couleurs.garde,
        etat?.titre ?? 'Gardé',
      ),
    );
  }
  for (const j of joursSup) {
    evts.push(
      evenementJour(`sup-${j.date}`, j.date, couleurs.ajoute, 'Ajouté'),
    );
  }
  return evts;
}
