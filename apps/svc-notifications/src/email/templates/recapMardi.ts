import type { PreavisRegle } from '../../database/schema.js';

/**
 * Template **pur** du mail récapitulatif du mardi (aucune I/O, aucune horloge), donc
 * testable comme une fonction. Le mardi, le parent reçoit l'invitation à **valider le
 * planning de la semaine N+1** : titre « Valider le planning de la semaine YYYY-Www »,
 * lien profond vers le front et rappel de **préavis propre à l'établissement** (2 jours
 * ouvrés crèche RM-03 / jeudi 12h ABCM RM-07). Le préavis est facultatif : si
 * l'établissement n'a pu être résolu (mode inconnu, annuaire indisponible), le mail est
 * émis sans la ligne de rappel plutôt que d'échouer.
 */

/** Paramètres de rendu du récap du mardi. */
export interface RecapMardiParams {
  /** Prénom de l'enfant du contrat (affiché tel quel, échappé). */
  readonly enfant: string;
  /** Semaine ISO concernée (`YYYY-Www`, ex. `2026-W27`). */
  readonly semaineIso: string;
  /** Lien profond vers l'écran de validation du front. */
  readonly lienApp: string;
  /** Libellé de l'établissement destinataire (`null` si non résolu). */
  readonly etablissementLibelle: string | null;
  /** Règle de préavis de l'établissement (`null` si non résolue). */
  readonly preavisRegle: PreavisRegle | null;
}

/** Message rendu prêt pour `MailerService.envoyer` (sujet + corps HTML et texte). */
export interface MessageRendu {
  readonly subject: string;
  readonly html: string;
  readonly text: string;
}

/** Échappe le texte interpolé dans le HTML (prénom/libellé viennent de la donnée). */
function echapper(valeur: string): string {
  return valeur
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/** Capitalise un jour stocké en majuscules (`JEUDI` → `jeudi`). */
function jourLisible(jour: string): string {
  return jour.toLowerCase();
}

/**
 * Phrase de rappel du préavis selon la règle de l'établissement. `null` si la règle
 * n'a pas pu être résolue (la ligne est alors omise du mail).
 */
function rappelPreavis(
  regle: PreavisRegle | null,
  libelle: string | null,
): string | null {
  if (!regle) {
    return null;
  }
  const ou = libelle ? ` (${libelle})` : '';
  if (regle.type === 'JOURS_OUVRES') {
    const jours =
      regle.valeur <= 1
        ? `${String(regle.valeur)} jour ouvré`
        : `${String(regle.valeur)} jours ouvrés`;
    return `Pensez à signaler tout changement au moins ${jours} à l'avance${ou}.`;
  }
  return `Pensez à signaler tout changement avant ${jourLisible(regle.jour)} ${regle.heure}${ou}.`;
}

/** Rend le mail récap du mardi (sujet + HTML + texte) pour une semaine et un contrat. */
export function recapMardi(params: RecapMardiParams): MessageRendu {
  const { enfant, semaineIso, lienApp, etablissementLibelle, preavisRegle } =
    params;
  const subject = `Valider le planning de la semaine ${semaineIso}`;
  const preavis = rappelPreavis(preavisRegle, etablissementLibelle);

  const enfantHtml = echapper(enfant);
  const lienHtml = echapper(lienApp);
  const html = [
    '<p>Bonjour,</p>',
    `<p>Le planning de <strong>${enfantHtml}</strong> pour la semaine <strong>${semaineIso}</strong> est à valider.</p>`,
    `<p><a href="${lienHtml}">${subject}</a></p>`,
    ...(preavis ? [`<p>${echapper(preavis)}</p>`] : []),
    '<p>— Crèche Planner</p>',
  ].join('\n');

  const text = [
    'Bonjour,',
    '',
    `Le planning de ${enfant} pour la semaine ${semaineIso} est à valider.`,
    '',
    `${subject} : ${lienApp}`,
    ...(preavis ? ['', preavis] : []),
    '',
    '— Crèche Planner',
  ].join('\n');

  return { subject, html, text };
}
