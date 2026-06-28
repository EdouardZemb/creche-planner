import type { PlageHoraire } from '../types/bff';
import { minutesDeHhmm, versHhmm } from './heures';

// Classification d'une absence par rapport à la plage de garde du contrat.
// Module pur, sans état ni dépendance UI : sépare la « journée complète »
// (vraie absence) des simples ajustements partiels (départ avancé / arrivée
// retardée) pour lever l'ambiguïté de l'affichage « Absent » du planning.

/** Résultat de la classification d'une absence sur un jour gardé. */
export interface EtatAbsenceClasse {
  /** 'absent' = la fenêtre couvre toute la garde ; 'ajuste' = ajustement partiel. */
  readonly statut: 'absent' | 'ajuste';
  /** Libellé court : « Absent », « Départ avancé », « Arrivée retardée », « Ajusté ». */
  readonly libelle: string;
  /** Plage de présence RETENUE de l'enfant (HH:MM–HH:MM, tiret demi-cadratin « – »), ou null si non dérivable. */
  readonly presence: string | null;
}

/**
 * Classe une absence (fenêtre `debut→fin`) au regard de la plage de garde du
 * contrat ce jour-là. Tout est comparé en minutes depuis minuit.
 *
 * - Sans plage de contrat (ne devrait pas arriver pour un jour gardé) :
 *   ajustement partiel non dérivable, par sécurité.
 * - Fenêtre couvrant toute la garde → vraie absence (« Absent »).
 * - Absence en fin de journée → « Départ avancé » (présent du début jusqu'au
 *   début de l'absence).
 * - Absence en début de journée → « Arrivée retardée » (présent de la fin de
 *   l'absence jusqu'au départ).
 * - Fenêtre intérieure ou cas dégénéré → « Ajusté » sans présence dérivable.
 */
export function classerAbsence(
  absence: PlageHoraire,
  plageContrat: { arrivee: string; depart: string } | null,
): EtatAbsenceClasse {
  if (plageContrat === null) {
    return { statut: 'ajuste', libelle: 'Ajusté', presence: null };
  }

  const arrivee = minutesDeHhmm(plageContrat.arrivee);
  const depart = minutesDeHhmm(plageContrat.depart);
  const debut = minutesDeHhmm(
    versHhmm(absence.debutHeures, absence.debutMinutes),
  );
  const fin = minutesDeHhmm(versHhmm(absence.finHeures, absence.finMinutes));

  if (debut <= arrivee && fin >= depart) {
    return { statut: 'absent', libelle: 'Absent', presence: null };
  }

  if (fin >= depart && debut > arrivee) {
    return {
      statut: 'ajuste',
      libelle: 'Départ avancé',
      presence: `${plageContrat.arrivee}–${versHhmm(
        absence.debutHeures,
        absence.debutMinutes,
      )}`,
    };
  }

  if (debut <= arrivee && fin < depart) {
    return {
      statut: 'ajuste',
      libelle: 'Arrivée retardée',
      presence: `${versHhmm(absence.finHeures, absence.finMinutes)}–${
        plageContrat.depart
      }`,
    };
  }

  return { statut: 'ajuste', libelle: 'Ajusté', presence: null };
}
