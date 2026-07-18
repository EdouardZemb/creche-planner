import type {
  ContratBesoinsSemaine,
  Mode,
  PlageHoraire,
  SemaineBesoins,
  SemaineTypeCreche,
} from '../types/bff';
import { classerAbsence, classerAjustement } from '../planning/etatJourGarde';
import { formaterPlage, minutesDeHhmm, versHhmm } from '../planning/heures';
import { jourSemaineDeIso } from '../utils/dates';

// Logique **pure** du tableau de bord « ma journée » : à partir de la vue
// hebdomadaire consolidée du foyer (`SemaineBesoins`, même forme que l'éditeur
// hebdo) et d'une date `YYYY-MM-DD`, produit la liste des contrats **concernés ce
// jour-là** avec leur état et leur horaire effectif.
//
// Cette fonction GÉNÉRALISE `EditeurContratSemaine.resume(date)` (qui ne renvoyait
// qu'une chaîne d'affichage pour un seul contrat) en une donnée structurée par
// ligne, tous contrats du foyer confondus. Elle RÉUTILISE `classerAbsence` pour le
// découpage Absent / Départ avancé / Arrivée retardée / Ajusté d'une absence crèche.
//
// Aucune I/O, aucune horloge : la date est fournie par l'appelant (cf.
// `jourCourantParis` côté `shared-semaine`). Module testable en isolation.

/**
 * État d'un contrat sur un jour donné (table D3). Jeton **stable** (la couche UI le
 * traduit en libellé/couleur) :
 * - `garde` — crèche présente sur sa journée de base (semaine-type) ;
 * - `absent` / `depart-avance` / `arrivee-retardee` / `ajuste` — absence crèche
 *   classée par `classerAbsence` au regard de la plage de base ;
 * - `arrivee-avancee` / `arrivee-retardee` / `depart-avance` / `depart-retarde` /
 *   `ajuste` — ajustement d'heures **réelles** classé par `classerAjustement` ;
 * - `jour-ajoute` — jour de garde crèche ponctuel hors semaine-type ;
 * - `cantine` — repas cantine ce jour (ABCM) ;
 * - `peri` — périscolaire matin et/ou soir ce jour (ABCM) ;
 * - `alsh` — accueil de loisirs ce jour.
 */
export type EtatJour =
  | 'garde'
  | 'absent'
  | 'depart-avance'
  | 'depart-retarde'
  | 'arrivee-avancee'
  | 'arrivee-retardee'
  | 'ajuste'
  | 'jour-ajoute'
  | 'cantine'
  | 'peri'
  | 'alsh';

/** Une ligne du tableau de bord du jour : un contrat concerné, son état et son horaire. */
export interface LigneJour {
  readonly contratId: string;
  readonly enfant: string;
  readonly mode: Mode;
  /** Libellé de l'établissement réel, `null` si le contrat n'y est pas (encore) rattaché. */
  readonly etablissementLibelle: string | null;
  readonly etat: EtatJour;
  /** Horaire/fenêtre effectif à afficher (`HH:MM–HH:MM`, « matin + soir », …), `null` si sans objet. */
  readonly horaire: string | null;
  /**
   * Semaine-type du contrat crèche, `undefined` hors CRECHE_PSU : permet à l'écran
   * de dériver la plage de garde d'un jour (`plageGardeDuJour`) pour le geste
   * « Signaler une absence » (A1), sans réinterroger la vue. Purement porté, la
   * couche pure ne l'exploite pas.
   */
  readonly semaineType?: SemaineTypeCreche;
}

/** Libellé d'absence crèche (`classerAbsence`) → jeton d'état stable. */
const ETAT_ABSENCE: Readonly<Record<string, EtatJour>> = {
  Absent: 'absent',
  'Départ avancé': 'depart-avance',
  'Arrivée retardée': 'arrivee-retardee',
  Ajusté: 'ajuste',
};

/** Libellé d'ajustement d'heures (`classerAjustement`) → jeton d'état stable. */
const ETAT_AJUSTEMENT: Readonly<Record<string, EtatJour>> = {
  'Arrivée avancée': 'arrivee-avancee',
  'Arrivée retardée': 'arrivee-retardee',
  'Départ avancé': 'depart-avance',
  'Départ retardé': 'depart-retarde',
  'Horaires ajustés': 'ajuste',
};

/** `minutes depuis minuit` → `HH:MM`. */
function minutesVersHhmm(minutes: number): string {
  return versHhmm(Math.floor(minutes / 60), minutes % 60);
}

/**
 * Enveloppe `{ arrivee, depart }` d'une journée de base crèche : première arrivée et
 * dernier départ couvrant toutes les plages du jour (la base peut en comporter
 * plusieurs : matin + après-midi). `null` si aucune plage (jour non gardé), ce qui
 * conduit `classerAbsence` à « Ajusté » par sécurité.
 */
function enveloppeBase(
  plages: readonly PlageHoraire[],
): { arrivee: string; depart: string } | null {
  if (plages.length === 0) {
    return null;
  }
  let debutMin = Number.POSITIVE_INFINITY;
  let finMax = Number.NEGATIVE_INFINITY;
  for (const p of plages) {
    debutMin = Math.min(
      debutMin,
      minutesDeHhmm(versHhmm(p.debutHeures, p.debutMinutes)),
    );
    finMax = Math.max(
      finMax,
      minutesDeHhmm(versHhmm(p.finHeures, p.finMinutes)),
    );
  }
  return {
    arrivee: minutesVersHhmm(debutMin),
    depart: minutesVersHhmm(finMax),
  };
}

/** Calcule la ligne d'un contrat **crèche** pour le jour, ou `null` s'il n'est pas concerné. */
function ligneCreche(
  contrat: ContratBesoinsSemaine,
  dateIso: string,
): { etat: EtatJour; horaire: string | null } | null {
  const jour = jourSemaineDeIso(dateIso);
  const jourBesoins = contrat.besoins[dateIso];
  const ajustement = jourBesoins?.ajustements[0];
  const absence = jourBesoins?.absences[0];
  const sup = jourBesoins?.joursSupplementaires[0];
  const base = contrat.semaineType?.[jour] ?? [];

  if (ajustement) {
    const classe = classerAjustement(ajustement, enveloppeBase(base));
    return {
      etat: ETAT_AJUSTEMENT[classe.libelle] ?? 'ajuste',
      horaire: classe.presence,
    };
  }
  if (absence) {
    const classe = classerAbsence(absence, enveloppeBase(base));
    return {
      etat: ETAT_ABSENCE[classe.libelle] ?? 'ajuste',
      horaire: classe.presence,
    };
  }
  if (sup) {
    return { etat: 'jour-ajoute', horaire: formaterPlage(sup) };
  }
  if (base.length > 0) {
    return { etat: 'garde', horaire: base.map(formaterPlage).join(', ') };
  }
  return null;
}

/** Calcule la ligne d'un contrat **ABCM** (cantine / périscolaire / ALSH), ou `null`. */
function ligneAbcm(
  contrat: ContratBesoinsSemaine,
  dateIso: string,
): { etat: EtatJour; horaire: string | null } | null {
  const jour = jourSemaineDeIso(dateIso);
  const jourBesoins = contrat.besoins[dateIso];

  if (contrat.mode === 'ALSH') {
    // Un jour réservé par date (vacances) prime ; sinon la récurrence
    // hebdomadaire de la semaine-type, ajustable par exception datée (`alsh`).
    const explicite = jourBesoins?.joursAlsh[0];
    const exc = jourBesoins?.exceptions[0];
    const base = contrat.semaineAbcm?.[jour]?.alsh;
    const recurrent =
      exc?.alsh !== undefined
        ? exc.alsh
          ? (base ?? { type: 'COMPLETE' as const })
          : undefined
        : base;
    const j = explicite ?? recurrent;
    if (!j) {
      return null;
    }
    let horaire = 'Journée';
    if (j.type === 'DEMI') {
      horaire = 'Demi-journée';
    } else if (j.repas) {
      horaire = 'Journée + repas';
    }
    return { etat: 'alsh', horaire };
  }

  // Cantine / périscolaire : une exception datée prime sur la semaine-type ABCM.
  const exc = jourBesoins?.exceptions[0];
  const base = contrat.semaineAbcm?.[jour];

  if (contrat.mode === 'CANTINE') {
    const cantine = exc ? (exc.cantine ?? false) : (base?.cantine ?? false);
    return cantine ? { etat: 'cantine', horaire: null } : null;
  }

  // PERISCOLAIRE : une exception remplace entièrement l'inscription du jour.
  const matin = exc ? (exc.periMatin ?? false) : (base?.periMatin ?? false);
  const soir = exc ? (exc.periSoir ?? false) : (base?.periSoir ?? false);
  const parts: string[] = [];
  if (matin) parts.push('matin');
  if (soir) parts.push('soir');
  return parts.length > 0 ? { etat: 'peri', horaire: parts.join(' + ') } : null;
}

/**
 * Les lignes du jour `dateIso` (`YYYY-MM-DD`) pour le foyer : un item par contrat
 * **concerné** ce jour-là, dans l'ordre des contrats de la vue. Sont exclus les
 * contrats sans présence ce jour (jour non gardé, week-end, sans cantine/péri, ALSH
 * non réservé), ainsi que les dates hors période d'activité du contrat.
 */
export function lignesDuJour(
  vue: SemaineBesoins,
  dateIso: string,
): LigneJour[] {
  const libelleParId = new Map(
    vue.etablissements.map((e) => [e.etablissementId, e.libelle]),
  );

  const lignes: LigneJour[] = [];
  for (const contrat of vue.contrats) {
    const calc =
      contrat.mode === 'CRECHE_PSU'
        ? ligneCreche(contrat, dateIso)
        : ligneAbcm(contrat, dateIso);
    if (calc === null) {
      continue;
    }
    lignes.push({
      contratId: contrat.contratId,
      enfant: contrat.enfant,
      mode: contrat.mode,
      etablissementLibelle:
        contrat.etablissementId !== null
          ? (libelleParId.get(contrat.etablissementId) ?? null)
          : null,
      etat: calc.etat,
      horaire: calc.horaire,
      // Porté tel quel (crèche uniquement) pour dériver la plage de garde côté
      // écran ; propriété OMISE pour les contrats ABCM (`exactOptionalPropertyTypes`).
      ...(contrat.semaineType !== undefined
        ? { semaineType: contrat.semaineType }
        : {}),
    });
  }
  return lignes;
}
