import type { PreavisRegle } from '../../database/schema.js';

/**
 * Template **pur** du mail récapitulatif du mardi (aucune I/O, aucune horloge), donc
 * testable comme une fonction. Le mardi, les parents du foyer reçoivent l'invitation à
 * **valider le planning de la semaine N+1** : titre « Valider le planning de la semaine
 * YYYY-Www », lien profond vers le front et rappel de **préavis propre à
 * l'établissement** (2 jours ouvrés crèche RM-03 / jeudi 12h ABCM RM-07).
 *
 * Depuis la PR4 « parents du foyer », un **seul** mail est adressé **par foyer** et
 * regroupe **tous les enfants** (contrats) fraîchement notifiés de la semaine — d'où la
 * liste `enfants`. Chaque enfant porte son établissement/préavis ; les rappels de
 * préavis identiques (deux enfants dans la même crèche) sont **dédupliqués**. Le
 * préavis reste facultatif : un établissement non résolu n'ajoute pas de ligne plutôt
 * que d'échouer.
 */

/** Un enfant/contrat du foyer concerné par le récap de la semaine. */
export interface RecapMardiEnfant {
  /** Prénom de l'enfant du contrat (affiché tel quel, échappé). */
  readonly enfant: string;
  /** Libellé de l'établissement destinataire (`null` si non résolu). */
  readonly etablissementLibelle: string | null;
  /** Règle de préavis de l'établissement (`null` si non résolue). */
  readonly preavisRegle: PreavisRegle | null;
}

/** Paramètres de rendu du récap du mardi (regroupé par foyer). */
export interface RecapMardiParams {
  /** Enfants/contrats du foyer notifiés cette semaine (au moins un). */
  readonly enfants: readonly RecapMardiEnfant[];
  /** Semaine ISO concernée (`YYYY-Www`, ex. `2026-W27`). */
  readonly semaineIso: string;
  /** Lien profond vers l'écran de validation du front. */
  readonly lienApp: string;
  /**
   * Lien **visible** de désabonnement (RFC 8058, PR5) vers la page publique de
   * confirmation, **propre au destinataire** (jeton one-shot). Facultatif : absent
   * en repli (adresse globale) ou si l'émission du jeton a échoué — le mail part
   * alors sans pied de page de désabonnement, mais reste conforme (l'en-tête
   * `List-Unsubscribe` est posé séparément par l'appelant quand un jeton existe).
   */
  readonly lienDesabonnement?: string;
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

/** Rappels de préavis **distincts** des enfants (deux mêmes établissements ⇒ une ligne). */
function preavisDistincts(enfants: readonly RecapMardiEnfant[]): string[] {
  const vus = new Set<string>();
  const lignes: string[] = [];
  for (const e of enfants) {
    const preavis = rappelPreavis(e.preavisRegle, e.etablissementLibelle);
    if (preavis !== null && !vus.has(preavis)) {
      vus.add(preavis);
      lignes.push(preavis);
    }
  }
  return lignes;
}

/** Énumère « A », « A et B », « A, B et C » à partir d'une liste de libellés. */
function enumerer(noms: readonly string[]): string {
  if (noms.length <= 1) {
    return noms[0] ?? '';
  }
  const debut = noms.slice(0, -1).join(', ');
  return `${debut} et ${noms[noms.length - 1]}`;
}

/**
 * Rend le mail récap du mardi (sujet + HTML + texte) pour une semaine et l'ensemble
 * des enfants/contrats d'un foyer notifiés cette semaine.
 */
export function recapMardi(params: RecapMardiParams): MessageRendu {
  const { enfants, semaineIso, lienApp, lienDesabonnement } = params;
  const subject = `Valider le planning de la semaine ${semaineIso}`;
  const preavis = preavisDistincts(enfants);
  const pluriel = enfants.length > 1;

  const noms = enfants.map((e) => e.enfant);
  const phraseTexte = pluriel
    ? `Les plannings de ${enumerer(noms)} pour la semaine ${semaineIso} sont à valider.`
    : `Le planning de ${enumerer(noms)} pour la semaine ${semaineIso} est à valider.`;

  const nomsHtml = enfants.map((e) => `<strong>${echapper(e.enfant)}</strong>`);
  const lienHtml = echapper(lienApp);
  const phraseHtml = pluriel
    ? `Les plannings de ${enumerer(nomsHtml)} pour la semaine <strong>${semaineIso}</strong> sont à valider.`
    : `Le planning de ${enumerer(nomsHtml)} pour la semaine <strong>${semaineIso}</strong> est à valider.`;

  const pieds = lienDesabonnement
    ? {
        html: `<p style="color:#666;font-size:0.85em">Vous ne souhaitez plus recevoir ces rappels par e-mail ? <a href="${echapper(lienDesabonnement)}">Se désabonner</a>.</p>`,
        text: `Se désabonner de ces rappels par e-mail : ${lienDesabonnement}`,
      }
    : null;

  const html = [
    '<p>Bonjour,</p>',
    `<p>${phraseHtml}</p>`,
    `<p><a href="${lienHtml}">${subject}</a></p>`,
    ...preavis.map((p) => `<p>${echapper(p)}</p>`),
    '<p>— Crèche Planner</p>',
    ...(pieds ? [pieds.html] : []),
  ].join('\n');

  const text = [
    'Bonjour,',
    '',
    phraseTexte,
    '',
    `${subject} : ${lienApp}`,
    ...(preavis.length > 0 ? ['', ...preavis] : []),
    '',
    '— Crèche Planner',
    ...(pieds ? ['', pieds.text] : []),
  ].join('\n');

  return { subject, html, text };
}
