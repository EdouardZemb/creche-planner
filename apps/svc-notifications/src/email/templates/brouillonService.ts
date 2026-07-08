import { libelleSemaineFr } from '@creche-planner/shared-semaine';
import type {
  DeltaJour,
  DeltaModifs,
  SaisieJour,
} from '../../validation/validation.diff.js';
import type { MessageRendu } from './recapMardi.js';

/**
 * Template **pur** (aucune I/O, aucune horloge) du mail de récapitulatif **agrégé par
 * établissement** adressé au **service** (crèche / école ABCM) après relecture humaine.
 * Granularité de l'édition hebdo (Phase 4) : **un seul mail par établissement**
 * regroupant **tous les enfants** du foyer dont la semaine a été validée avec
 * modifications (remplace le récap par-contrat du Lot 6). Il rend, à partir des
 * `delta_modifs` figés à la validation (Lot 4) de chaque enfant, un récap lisible des
 * jours modifiés sous un en-tête nommant l'établissement et la semaine.
 *
 * Le contenu rendu ici est **figé** dans `envoi_etablissement.corps` : c'est la preuve
 * de ce qui a réellement été adressé. La fonction étant pure, ce qu'on teste est
 * exactement ce qui part. Aucune décision d'envoi (dry-run, allowlist) n'est prise
 * ici : elle appartient au `MailerService` et au service appelant.
 */

/** Un enfant concerné par le récap, avec ses jours modifiés figés à la validation. */
export interface EnfantModifie {
  /** Prénom de l'enfant du contrat (affiché tel quel, échappé). */
  readonly enfant: string;
  /** Jours modifiés depuis la notification (delta figé à la validation). */
  readonly deltaModifs: DeltaModifs;
}

/** Paramètres de rendu du brouillon de mail agrégé au service. */
export interface BrouillonServiceParams {
  /** Semaine ISO concernée (`YYYY-Www`, ex. `2026-W27`). */
  readonly semaineIso: string;
  /** Libellé de l'établissement destinataire (ex. « Crèche Les Hirondelles »). */
  readonly etablissementLibelle: string;
  /** Enfants du foyer concernés par cet établissement, dans l'ordre d'affichage. */
  readonly enfants: readonly EnfantModifie[];
}

/** Catégories datées d'un jour, dans l'ordre d'affichage, avec leur libellé pluralisable. */
const CATEGORIES: readonly {
  readonly cle: keyof SaisieJour;
  readonly singulier: string;
  readonly pluriel: string;
}[] = [
  {
    cle: 'absences',
    singulier: 'absence',
    pluriel: 'absences',
  },
  {
    cle: 'joursSupplementaires',
    singulier: 'jour supplémentaire',
    pluriel: 'jours supplémentaires',
  },
  {
    cle: 'exceptions',
    singulier: 'ajustement (cantine/périscolaire)',
    pluriel: 'ajustements (cantine/périscolaire)',
  },
  {
    cle: 'joursAlsh',
    singulier: 'jour ALSH',
    pluriel: 'jours ALSH',
  },
];

/** Échappe le texte interpolé dans le HTML (prénom/libellé viennent de la donnée). */
function echapper(valeur: string): string {
  return valeur
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/** `2026-06-29` → `29/06/2026` (affichage FR, sans dépendance ni fuseau). */
function jourLisible(date: string): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return date;
  }
  return `${date.slice(8, 10)}/${date.slice(5, 7)}/${date.slice(0, 4)}`;
}

/** « 1 absence », « 2 absences » — pluriel simple sur le compte. */
function compte(n: number, singulier: string, pluriel: string): string {
  return `${String(n)} ${n > 1 ? pluriel : singulier}`;
}

/** `8`,`0` → `08:00` (heure d'affichage, zéro-paddée). */
function heureLisible(heures: unknown, minutes: unknown): string | null {
  if (typeof heures !== 'number' || typeof minutes !== 'number') {
    return null;
  }
  return `${String(heures).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`;
}

/**
 * Rend un ajustement d'heures réelles en clair pour le personnel de la crèche :
 * « présence 08:00–16:30 » (plage RÉELLE du jour). La plage contractuelle n'est pas
 * disponible dans le delta — on n'affiche que la présence. `null` si l'item est
 * malformé (on l'ignore alors sans casser le récap).
 */
function presenceLisible(item: unknown): string | null {
  const a = item as {
    debutHeures?: unknown;
    debutMinutes?: unknown;
    finHeures?: unknown;
    finMinutes?: unknown;
  };
  const debut = heureLisible(a.debutHeures, a.debutMinutes);
  const fin = heureLisible(a.finHeures, a.finMinutes);
  return debut !== null && fin !== null ? `présence ${debut}–${fin}` : null;
}

/**
 * Résume l'état **après** modification d'un jour : la liste des entrées par
 * catégorie, ou « journée retirée du planning » quand le jour n'a plus d'entrée
 * (snapshot `apres` absent). Le snapshot canonique n'inclut un jour que s'il porte
 * au moins une entrée, donc `apres` présent ⇒ au moins une catégorie non vide.
 */
function resumeJour(jour: DeltaJour): string {
  const apres = jour.apres;
  if (!apres) {
    return 'journée retirée du planning';
  }
  const morceaux = CATEGORIES.flatMap((c) => {
    const n = apres[c.cle].length;
    return n > 0 ? [compte(n, c.singulier, c.pluriel)] : [];
  });
  // Les ajustements d'heures réelles sont rendus en clair (présence HH:MM–HH:MM)
  // plutôt qu'en compte : c'est l'information utile au service. Lecture défensive :
  // un `delta_modifs` figé avant l'ajout de la catégorie n'a pas la clé (≡ vide).
  const ajustementsJour =
    (apres as { ajustements?: readonly unknown[] }).ajustements ?? [];
  const ajustements = ajustementsJour.flatMap((item) => {
    const presence = presenceLisible(item);
    return presence !== null ? [presence] : [];
  });
  const morceauxTout = [...morceaux, ...ajustements];
  return morceauxTout.length > 0 ? morceauxTout.join(', ') : 'journée modifiée';
}

/** Lignes « date : résumé » d'un enfant (vide si aucun jour modifié). */
function lignesEnfant(enfant: EnfantModifie): string[] {
  return enfant.deltaModifs.jours.map(
    (j) => `${jourLisible(j.date)} : ${resumeJour(j)}`,
  );
}

/**
 * Rend le brouillon (sujet + HTML + texte) du mail **agrégé par établissement** : un
 * bloc par enfant concerné, listant ses jours modifiés. Si aucun enfant n'a de
 * modification (cas dégénéré), le récap l'indique explicitement.
 */
export function brouillonServiceAgrege(
  params: BrouillonServiceParams,
): MessageRendu {
  const { semaineIso, etablissementLibelle, enfants } = params;
  // Libellé parent (« semaine du 6 au 12 juillet 2026 ») lisible par le service.
  const libelle = libelleSemaineFr(semaineIso);
  const subject = `Plannings modifiés — ${libelle}`;
  const etabHtml = echapper(etablissementLibelle);

  const aucune = enfants.length === 0;

  const blocsHtml = aucune
    ? ['<p>Aucune modification déclarée sur cette semaine.</p>']
    : enfants.flatMap((e) => {
        const lignes = lignesEnfant(e);
        const enfantHtml = echapper(e.enfant);
        return [
          `<p><strong>${enfantHtml}</strong></p>`,
          ...(lignes.length > 0
            ? ['<ul>', ...lignes.map((l) => `<li>${echapper(l)}</li>`), '</ul>']
            : ['<p>Aucune modification déclarée sur cette semaine.</p>']),
        ];
      });

  const html = [
    `<p>Bonjour ${etabHtml},</p>`,
    `<p>Voici le récapitulatif des modifications de planning pour la <strong>${libelle}</strong>.</p>`,
    ...blocsHtml,
    '<p>Cordialement,</p>',
    '<p>— Crèche Planner (pour la famille)</p>',
  ].join('\n');

  const blocsTexte = aucune
    ? ['Aucune modification déclarée sur cette semaine.']
    : enfants.flatMap((e) => {
        const lignes = lignesEnfant(e);
        return [
          `${e.enfant} :`,
          ...(lignes.length > 0
            ? lignes.map((l) => `- ${l}`)
            : ['- Aucune modification déclarée sur cette semaine.']),
          '',
        ];
      });

  const text = [
    `Bonjour ${etablissementLibelle},`,
    '',
    `Voici le récapitulatif des modifications de planning pour la ${libelle}.`,
    '',
    ...blocsTexte,
    'Cordialement,',
    '— Crèche Planner (pour la famille)',
  ].join('\n');

  return { subject, html, text };
}
