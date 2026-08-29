import type { ContratLocal } from '../types/bff';

/**
 * **État d'un contrat vis-à-vis du mois affiché**, et choix du contrat à ouvrir.
 *
 * Le planning indexait ses sous-onglets sur le **mode** de garde (`CRECHE_PSU`,
 * `CANTINE`…) : deux contrats crèche successifs pour le même enfant — l'ancien
 * qui s'achève, celui de la rentrée qui commence — produisaient donc deux onglets
 * portant le **même libellé**, le même `id` DOM, tous deux `aria-selected`, et
 * `find(c => c.mode === mode)` ne rendait jamais que le **premier**. Le contrat de
 * la rentrée était ainsi injoignable, quel que soit l'onglet cliqué.
 *
 * Ces fonctions sont pures et sans horloge : le mois de référence est **passé** par
 * l'appelant. Un contrat n'est donc jamais « échu » dans l'absolu, mais échu *pour
 * le mois qu'on regarde* — c'est bien ce que l'écran montre.
 */

/** Position d'un contrat par rapport au mois affiché. */
export type EtatContrat = 'en-cours' | 'a-venir' | 'echu';

/** Contrat réduit à ce qui détermine son état (facilite les tests et les appels). */
export interface PeriodeContrat {
  readonly valideDu: string;
  readonly valideAu: string | null;
}

/**
 * Borne haute lexicographique du mois : toute date réelle du mois lui est
 * inférieure ou égale. Le 31 est volontaire même pour février — on compare des
 * chaînes ISO, pas des dates, et aucun jour réel ne dépasse `-31`.
 */
function finDeMois(mois: string): string {
  return `${mois}-31`;
}

/** Première date du mois affiché. */
function debutDeMois(mois: string): string {
  return `${mois}-01`;
}

/** Vrai si le contrat couvre au moins un jour du mois affiché. */
export function couvreLeMois(contrat: PeriodeContrat, mois: string): boolean {
  return (
    contrat.valideDu <= finDeMois(mois) &&
    (contrat.valideAu === null || contrat.valideAu >= debutDeMois(mois))
  );
}

/** État du contrat pour le mois affiché. */
export function etatContrat(
  contrat: PeriodeContrat,
  mois: string,
): EtatContrat {
  if (contrat.valideAu !== null && contrat.valideAu < debutDeMois(mois)) {
    return 'echu';
  }
  if (contrat.valideDu > finDeMois(mois)) {
    return 'a-venir';
  }
  return 'en-cours';
}

/** Date ISO `YYYY-MM-DD` → `JJ/MM/AAAA`. */
function formaterDate(iso: string): string {
  const [annee, mois, jour] = iso.split('-');
  if (!annee || !mois || !jour) {
    return iso;
  }
  return `${jour}/${mois}/${annee}`;
}

/**
 * Sous-titre d'onglet qui **distingue** deux contrats de même mode et dit d'un
 * coup d'œil lequel est encore actif. C'est la ligne qui manquait : sans elle,
 * deux contrats crèche s'affichaient tous deux « Crèche », sans rien d'autre.
 */
export function libelleEtatContrat(
  contrat: PeriodeContrat,
  mois: string,
): string {
  switch (etatContrat(contrat, mois)) {
    case 'echu':
      // `valideAu` est forcément non nul ici (un contrat sans terme n'est jamais échu).
      return `terminé le ${formaterDate(contrat.valideAu ?? '')}`;
    case 'a-venir':
      return `à partir du ${formaterDate(contrat.valideDu)}`;
    case 'en-cours':
      return contrat.valideAu === null
        ? `depuis le ${formaterDate(contrat.valideDu)}`
        : `jusqu’au ${formaterDate(contrat.valideAu)}`;
  }
}

/**
 * Mois (`YYYY-MM`) où ce contrat a quelque chose à saisir : son premier mois s'il
 * n'a pas commencé, son dernier s'il est terminé. `null` s'il couvre déjà le mois
 * affiché — il n'y a alors nulle part où aller.
 */
export function moisUtile(
  contrat: PeriodeContrat,
  mois: string,
): string | null {
  switch (etatContrat(contrat, mois)) {
    case 'a-venir':
      return contrat.valideDu.slice(0, 7);
    case 'echu':
      return (contrat.valideAu ?? '').slice(0, 7);
    case 'en-cours':
      return null;
  }
}

/**
 * Contrat à ouvrir par défaut pour le mois affiché, quand l'URL n'en désigne
 * aucun. L'ordre importe : un contrat **valide pour le mois** d'abord ; sinon
 * celui **à venir le plus proche** — c'est le cas de la rentrée, et c'est celui
 * que le parent veut remplir ; sinon le **dernier terminé**, faute de mieux.
 *
 * L'ancien repli était `contrats[0]`, c'est-à-dire, dans l'ordre de tri du
 * service, le contrat le plus ancien : en août, l'écran s'ouvrait donc sur un
 * contrat clos en juillet plutôt que sur celui de septembre.
 */
export function contratParDefaut<T extends PeriodeContrat>(
  contrats: readonly T[],
  mois: string,
): T | null {
  const couvrant = contrats.find((c) => couvreLeMois(c, mois));
  if (couvrant) {
    return couvrant;
  }
  const aVenir = contrats
    .filter((c) => etatContrat(c, mois) === 'a-venir')
    .sort((a, b) => a.valideDu.localeCompare(b.valideDu))[0];
  if (aVenir) {
    return aVenir;
  }
  const termines = contrats
    .filter((c) => etatContrat(c, mois) === 'echu')
    .sort((a, b) => (a.valideAu ?? '').localeCompare(b.valideAu ?? ''));
  return termines[termines.length - 1] ?? contrats[0] ?? null;
}

/**
 * Résout le contrat affiché depuis les paramètres d'URL. `?contrat=<id>` est
 * précis et prioritaire ; `?mode=` reste accepté pour ne pas casser les liens
 * profonds déjà émis (dashboard, mails du mardi), en sachant qu'il ne peut pas
 * départager deux contrats de même mode — raison d'être de `?contrat=`.
 */
export function resoudreContratAffiche(
  contrats: readonly ContratLocal[],
  mois: string,
  contratParam: string | null,
  modeParam: string | null,
): ContratLocal | null {
  return (
    contrats.find((c) => c.id === contratParam) ??
    contrats.find((c) => c.mode === modeParam) ??
    contratParDefaut(contrats, mois)
  );
}
