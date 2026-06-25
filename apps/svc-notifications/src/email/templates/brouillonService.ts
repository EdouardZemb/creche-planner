import type {
  DeltaJour,
  DeltaModifs,
  SaisieJour,
} from '../../validation/validation.diff.js';
import type { MessageRendu } from './recapMardi.js';

/**
 * Template **pur** (aucune I/O, aucune horloge) du mail de récapitulatif adressé au
 * **service** (crèche / école ABCM) après relecture humaine — première action
 * sortante vers un tiers réel (Lot 6). Il rend, à partir du `delta_modifs` figé à la
 * validation (Lot 4), un récap lisible des jours modifiés, sous un en-tête nommant
 * l'établissement, l'enfant et la semaine, suivi d'une signature.
 *
 * Le contenu rendu ici est **figé** dans `envoi_mail.corps` : c'est la preuve de ce
 * qui a réellement été adressé. La fonction étant pure, ce qu'on teste est exactement
 * ce qui part. Aucune décision d'envoi (dry-run, allowlist) n'est prise ici : elle
 * appartient au `MailerService` et au service appelant.
 */

/** Paramètres de rendu du brouillon de mail au service. */
export interface BrouillonServiceParams {
  /** Prénom de l'enfant du contrat (affiché tel quel, échappé). */
  readonly enfant: string;
  /** Semaine ISO concernée (`YYYY-Www`, ex. `2026-W27`). */
  readonly semaineIso: string;
  /** Libellé de l'établissement destinataire (ex. « Crèche Les Hirondelles »). */
  readonly etablissementLibelle: string;
  /** Jours modifiés depuis la notification (delta figé à la validation). */
  readonly deltaModifs: DeltaModifs;
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
  return morceaux.length > 0 ? morceaux.join(', ') : 'journée modifiée';
}

/** Rend le brouillon (sujet + HTML + texte) du mail au service pour une semaine. */
export function brouillonService(params: BrouillonServiceParams): MessageRendu {
  const { enfant, semaineIso, etablissementLibelle, deltaModifs } = params;
  const jours = deltaModifs.jours;
  const subject = `Planning de ${enfant} — semaine ${semaineIso} : modifications`;

  const enfantHtml = echapper(enfant);
  const etabHtml = echapper(etablissementLibelle);
  const lignes = jours.map((j) => `${jourLisible(j.date)} : ${resumeJour(j)}`);

  const corpsHtml =
    jours.length > 0
      ? [
          '<p>Modifications du planning :</p>',
          '<ul>',
          ...lignes.map((l) => `<li>${echapper(l)}</li>`),
          '</ul>',
        ]
      : ['<p>Aucune modification déclarée sur cette semaine.</p>'];

  const html = [
    `<p>Bonjour ${etabHtml},</p>`,
    `<p>Voici le récapitulatif du planning de <strong>${enfantHtml}</strong> pour la semaine <strong>${semaineIso}</strong>.</p>`,
    ...corpsHtml,
    '<p>Cordialement,</p>',
    '<p>— Crèche Planner (pour la famille)</p>',
  ].join('\n');

  const corpsTexte =
    jours.length > 0
      ? ['Modifications du planning :', ...lignes.map((l) => `- ${l}`)]
      : ['Aucune modification déclarée sur cette semaine.'];

  const text = [
    `Bonjour ${etablissementLibelle},`,
    '',
    `Voici le récapitulatif du planning de ${enfant} pour la semaine ${semaineIso}.`,
    '',
    ...corpsTexte,
    '',
    'Cordialement,',
    '— Crèche Planner (pour la famille)',
  ].join('\n');

  return { subject, html, text };
}
