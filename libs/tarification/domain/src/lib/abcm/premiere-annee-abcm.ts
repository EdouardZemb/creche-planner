/**
 * Prédicat **« première année ABCM »** (doc 02 §4.4, chantier Coûts lot 4b) :
 * détermine si les frais de 1ʳᵉ inscription s'appliquent au mois calculé, à
 * partir des **contrats du foyer** — et non plus d'une année codée en dur. Un
 * foyer est en première année ABCM pour l'année scolaire d'un mois donné si au
 * moins un de ses contrats ABCM est marqué « première inscription » et démarre
 * dans cette année scolaire (dérivée de `valideDu` : septembre → août).
 *
 * Module **pur** : aucune I/O, aucun type d'infrastructure — l'appelant mappe
 * ses lignes de read model vers `ContratPremiereAnnee`.
 */

/** Vue minimale d'un contrat pour le prédicat de première année ABCM. */
export interface ContratPremiereAnnee {
  /** `true` si le contrat est d'un mode ABCM (cantine/périscolaire/ALSH). */
  readonly modeAbcm: boolean;
  /** `true` si le contrat porte « première inscription de l'enfant à l'association ». */
  readonly premiereInscription: boolean;
  /** Début de validité ISO `YYYY-MM-DD`, ou `null` si inconnu (contrat historique). */
  readonly valideDu: string | null;
}

/**
 * Année **scolaire** de rattachement d'une date ISO `YYYY-MM-DD` : l'année
 * scolaire `N` court de septembre `N` à août `N+1`. Une date de septembre à
 * décembre appartient donc à l'année scolaire de son année civile ; une date de
 * janvier à août appartient à l'année scolaire précédente.
 */
export function anneeScolaireDe(dateIso: string): number {
  const annee = Number(dateIso.slice(0, 4));
  const mois = Number(dateIso.slice(5, 7));
  return mois >= 9 ? annee : annee - 1;
}

/**
 * `true` si le mois calculé (ISO `YYYY-MM`) relève de la **première année
 * ABCM** du foyer : il existe un contrat ABCM marqué « première inscription »
 * dont l'année scolaire de début (`valideDu`) est l'année du mois. Fonction
 * **totale** (tout mois est accepté) mais seule septembre déclenche des frais
 * fixes en pratique — pour un mois `YYYY-09`, l'année scolaire est `YYYY`, et
 * un contrat démarrant de `YYYY-09` à `YYYY+1-08` s'y rattache.
 */
export function estPremiereAnneeAbcm(
  mois: string,
  contrats: readonly ContratPremiereAnnee[],
): boolean {
  const anneeDuMois = Number(mois.slice(0, 4));
  return contrats.some(
    (contrat) =>
      contrat.modeAbcm &&
      contrat.premiereInscription &&
      contrat.valideDu !== null &&
      anneeScolaireDe(contrat.valideDu) === anneeDuMois,
  );
}
