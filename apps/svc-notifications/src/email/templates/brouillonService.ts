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
  /**
   * Lien vers la page publique d'information sur les données
   * (`construireLienMentions(appUrl)`). **Obligatoire** : ce message est le **seul**
   * canal par lequel l'agent de l'établissement apprend quoi que ce soit — il n'a pas
   * de compte et n'ouvre jamais l'application. Un pied manquant le laisserait sans
   * aucune information.
   */
  readonly lienMentions: string;
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
 * Phrase du pied d'information : pourquoi cette personne reçoit le message (collecte
 * indirecte — c'est la famille qui a saisi son adresse de service), qui édite l'outil.
 * C'est le seul endroit où elle peut l'apprendre : elle n'a pas de compte et n'ouvre
 * jamais l'application.
 *
 * ⚠️ Le nom du produit y est **toujours suivi de son apposition** (« l'outil familial
 * qu'elle utilise pour organiser la garde de ses enfants »). Un prénom seul — « Martha »
 * — se lit comme une **personne** pour un destinataire qui n'a jamais ouvert
 * l'application : c'est le point que le renommage du 2026-08-17 devait tenir, et c'est
 * l'apposition qui le tient, pas le nom (ADR-0009).
 */
const PHRASE_MENTIONS =
  "Vous recevez ce message parce que la famille vous a enregistré comme établissement d'accueil dans Martha, l'outil familial qu'elle utilise pour organiser la garde de ses enfants : votre adresse de service y a été saisie par elle, et non par vous.";

/**
 * Signature du récapitulatif adressé au **service**, distincte de celle du mail aux
 * parents (`recapMardi`, « — Martha » nu, où le nom est déjà connu du lecteur).
 *
 * L'ancienne signature disait « — Crèche Planner (pour la famille) » : le nom nommait
 * la fonction, la parenthèse disait pour le compte de qui. « — Martha (pour la
 * famille) » aurait gardé la parenthèse en perdant la fonction, et se serait lue
 * « Martha, quelqu'un de la famille » — une **mauvaise attribution**, pire que
 * l'opacité qu'on cherchait à éviter. La forme retenue rend les deux d'un coup : qui
 * écrit (une application), pour qui (la famille).
 */
const SIGNATURE = "Martha, l'application de planning de la famille";

/**
 * Pied d'information (HTML + texte) apposé au récapitulatif adressé à l'établissement.
 *
 * **Exporté à dessein** : le corps réellement envoyé n'est pas toujours celui rendu
 * ici. Quand le parent relit et réécrit le message dans l'application — ce que le front
 * fait **systématiquement** (`RelectureEnvoi` envoie toujours son `sujet`/`corps`) —
 * `EnvoiService` remplace le corps entier par son texte. Le pied doit alors être
 * réapposé côté serveur, sinon il disparaît du **seul** canal qui atteigne l'agent
 * d'établissement.
 */
export function piedInformationEtablissement(lienMentions: string): {
  readonly html: string;
  readonly text: string;
} {
  return {
    html: `<p style="color:#666;font-size:0.85em">${PHRASE_MENTIONS} <a href="${echapper(lienMentions)}">Informations sur les données enregistrées</a>.</p>`,
    text: `${PHRASE_MENTIONS}\nInformations sur les données enregistrées : ${lienMentions}`,
  };
}

/**
 * Rend le brouillon (sujet + HTML + texte) du mail **agrégé par établissement** : un
 * bloc par enfant concerné, listant ses jours modifiés. Si aucun enfant n'a de
 * modification (cas dégénéré), le récap l'indique explicitement.
 */
export function brouillonServiceAgrege(
  params: BrouillonServiceParams,
): MessageRendu {
  const { semaineIso, etablissementLibelle, enfants, lienMentions } = params;
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

  // Pied d'information : rendu par la fonction exportée ci-dessus, parce que le service
  // d'envoi doit pouvoir le réapposer quand le parent réécrit le corps.
  const pied = piedInformationEtablissement(lienMentions);

  const html = [
    `<p>Bonjour ${etabHtml},</p>`,
    `<p>Voici le récapitulatif des modifications de planning pour la <strong>${libelle}</strong>.</p>`,
    ...blocsHtml,
    '<p>Cordialement,</p>',
    `<p>— ${SIGNATURE}</p>`,
    pied.html,
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
    `— ${SIGNATURE}`,
    '',
    pied.text,
  ].join('\n');

  return { subject, html, text };
}
