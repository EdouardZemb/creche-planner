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

/** Résultat de la classification d'un ajustement d'heures réelles (Lot 2b). */
export interface EtatAjustementClasse {
  /**
   * Libellé court de l'écart : « Arrivée avancée », « Arrivée retardée »,
   * « Départ avancé », « Départ retardé », ou « Horaires ajustés » (deux bornes
   * modifiées, ou plage de contrat inconnue).
   */
  readonly libelle: string;
  /** Plage de présence RÉELLE (HH:MM–HH:MM, tiret demi-cadratin « – »). */
  readonly presence: string;
}

/**
 * Classe un ajustement d'heures **réelles** (plage de présence saisie) au regard de
 * la plage de garde contractuelle du jour. Mêmes conventions que `classerAbsence`
 * (comparaison en minutes depuis minuit), mais l'entrée porte la présence réelle :
 * `presence` restitue donc toujours la plage saisie.
 *
 * - une seule borne décalée → « Arrivée avancée/retardée » ou « Départ avancé/retardé » ;
 * - les deux bornes décalées → « Horaires ajustés » ;
 * - plage de contrat absente (ne devrait pas arriver sur un jour gardé) → « Horaires ajustés ».
 *
 * Une plage réelle strictement égale à la plage de contrat retombe sur « Horaires
 * ajustés » (aucune borne décalée) : ce cas est neutralisé en amont par l'éditeur,
 * qui ne persiste alors aucune entrée.
 */
export function classerAjustement(
  plageReelle: PlageHoraire,
  plageContrat: { arrivee: string; depart: string } | null,
): EtatAjustementClasse {
  const arriveeReelle = versHhmm(
    plageReelle.debutHeures,
    plageReelle.debutMinutes,
  );
  const departReel = versHhmm(plageReelle.finHeures, plageReelle.finMinutes);
  const presence = `${arriveeReelle}–${departReel}`;

  if (plageContrat === null) {
    return { libelle: 'Horaires ajustés', presence };
  }

  const arriveeContrat = minutesDeHhmm(plageContrat.arrivee);
  const departContrat = minutesDeHhmm(plageContrat.depart);
  const arriveeMin = minutesDeHhmm(arriveeReelle);
  const departMin = minutesDeHhmm(departReel);
  const arriveeDecalee = arriveeMin !== arriveeContrat;
  const departDecale = departMin !== departContrat;

  if (arriveeDecalee && departDecale) {
    return { libelle: 'Horaires ajustés', presence };
  }
  if (arriveeDecalee) {
    return {
      libelle:
        arriveeMin < arriveeContrat ? 'Arrivée avancée' : 'Arrivée retardée',
      presence,
    };
  }
  if (departDecale) {
    return {
      libelle: departMin < departContrat ? 'Départ avancé' : 'Départ retardé',
      presence,
    };
  }
  return { libelle: 'Horaires ajustés', presence };
}
