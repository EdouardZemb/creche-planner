/**
 * Composition **pure** du message in-app de la validation hebdomadaire (aucune I/O),
 * testable comme une fonction. L'inbox est un **journal informationnel** : le message
 * annonce simplement que le planning de la semaine est à valider, sans porter l'action
 * « Valider » elle-même (celle-ci reste dans l'encart `A_VALIDER`, cf. §5.6). On garde
 * le même vocabulaire que le mail récap du mardi (`recapMardi`) pour la cohérence, sans
 * pied de désabonnement (propre à l'e-mail), mais **avec** un lien profond : la carte de
 * la cloche devient tapable et mène en un tap à l'éditeur de la semaine concernée.
 */

/**
 * Message in-app rendu : sujet court + corps informationnel (texte brut) + lien profond
 * vers l'éditeur de la semaine. Le lien est un **chemin relatif** (`/foyers/…`) : le web
 * le rend tel quel (pas d'URL absolue en base).
 */
export interface MessageInApp {
  readonly sujet: string;
  readonly corps: string;
  readonly lien: string;
}

/** Énumère « A », « A et B », « A, B et C » à partir d'une liste de prénoms. */
function enumerer(noms: readonly string[]): string {
  if (noms.length <= 1) {
    return noms[0] ?? '';
  }
  const debut = noms.slice(0, -1).join(', ');
  return `${debut} et ${noms[noms.length - 1]}`;
}

/**
 * Rend le message in-app « planning à valider » pour une semaine et l'ensemble des
 * enfants/contrats d'un foyer fraîchement notifiés. Le pluriel s'accorde au nombre
 * d'enfants ; une liste vide reste tolérée (corps générique) même si l'appelant ne
 * l'invoque qu'avec au moins un enfant.
 */
export function messageValidationHebdo(params: {
  readonly foyerId: string;
  readonly noms: readonly string[];
  readonly semaineIso: string;
}): MessageInApp {
  const { foyerId, noms, semaineIso } = params;
  const sujet = `Planning de la semaine ${semaineIso} à valider`;
  const pluriel = noms.length > 1;
  const corps =
    noms.length === 0
      ? `Le planning de la semaine ${semaineIso} est à valider.`
      : pluriel
        ? `Les plannings de ${enumerer(noms)} pour la semaine ${semaineIso} sont à valider.`
        : `Le planning de ${enumerer(noms)} pour la semaine ${semaineIso} est à valider.`;
  const lien = `/foyers/${foyerId}/planning?semaine=${semaineIso}`;
  return { sujet, corps, lien };
}
