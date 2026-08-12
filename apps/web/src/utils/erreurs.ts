// Traduction des erreurs HTTP/réseau du BFF en messages lisibles pour
// l'utilisateur. Le BFF renvoie 502 sur panne réseau / timeout / circuit ouvert
// et propage les 4xx (404, 409, 422…). On centralise ici la conversion pour
// éviter d'afficher des messages techniques bruts ("HTTP 502") à l'écran.

import type { ErreurChamp } from '@creche-planner/contracts-kernel';
import { ApiError } from '../api/client';

/**
 * Erreur de validation rattachée à un champ. Le type vient du contrat partagé
 * (`import type` : rien n'est émis, la passerelle et le front décrivent donc la
 * même forme sans que `zod` entre dans le bundle du navigateur).
 */
export type { ErreurChamp };

const MESSAGE_5XX = 'Service indisponible, réessayez dans un instant.';

/** Convertit une erreur (ApiError ou Error) en message utilisateur en français. */
export function messageErreur(e: unknown): string {
  // Hors-ligne : une écriture tentée sans réseau échoue (le fetch rejette). On
  // court-circuite le mapping technique pour nommer la vraie cause au parent,
  // plutôt qu'un « Service indisponible » trompeur. La lecture, elle, est
  // servie par le cache du Service Worker et ne passe pas par ici.
  if (typeof navigator !== 'undefined' && !navigator.onLine) {
    return 'Vous êtes hors-ligne. Reconnectez-vous pour enregistrer vos changements.';
  }
  if (e instanceof ApiError) {
    if (e.status >= 500) {
      // 502 (réseau/timeout/circuit ouvert) et autres 5xx → indisponibilité.
      return MESSAGE_5XX;
    }
    switch (e.status) {
      case 400:
      case 422:
        // UT-04 (CA2) : message *orientant* quand le BFF ne détaille pas par
        // champ — on indique où regarder plutôt que de rester muet.
        return 'Données invalides : vérifiez les champs marqués et la première section du formulaire.';
      case 401:
      case 403:
        return 'Accès non autorisé.';
      case 404:
        return 'Ressource introuvable.';
      case 409:
        return 'Conflit : la ressource a déjà été modifiée.';
      default:
        return `Erreur ${e.status} : la requête a échoué.`;
    }
  }
  // TypeError = échec fetch (réseau coupé côté navigateur) → même message que 5xx.
  if (e instanceof TypeError) {
    return MESSAGE_5XX;
  }
  if (e instanceof Error && e.message) {
    return e.message;
  }
  return 'Une erreur inattendue est survenue.';
}

/** Vrai pour un objet indexable (et non un tableau). */
function estObjet(valeur: unknown): valeur is Record<string, unknown> {
  return (
    typeof valeur === 'object' && valeur !== null && !Array.isArray(valeur)
  );
}

/**
 * Extrait les erreurs par champ du corps `application/problem+json` renvoyé par
 * la passerelle (AQ-12 : implémentation unique, partagée par les formulaires
 * foyer, contrat, établissement et profil). Toute autre forme — corps absent,
 * problème sans membre `erreurs`, entrées partielles — donne `[]`, et l'appelant
 * retombe sur le message global ([messageErreur]).
 *
 * ⚠️ Cette fonction lisait auparavant un **tableau à la racine** du corps. Ce
 * n'était pas la forme du fil : `BadRequestException([{ champ, message }])`
 * ENVELOPPE le tableau (`{ message: [...], error, statusCode }`), si bien
 * qu'aucune erreur par champ n'a jamais atteint un écran (`AN-27`). Les six
 * tests qui « couvraient » ce chemin fabriquaient le corps à la main. Depuis le
 * lot 4 des standards, le tableau a un nom dans le contrat : `erreurs`.
 */
export function extraireErreurs(corps: unknown): ErreurChamp[] {
  if (!estObjet(corps) || !Array.isArray(corps['erreurs'])) {
    return [];
  }
  return corps['erreurs'].filter(
    (e): e is ErreurChamp =>
      estObjet(e) &&
      typeof e['champ'] === 'string' &&
      typeof e['message'] === 'string',
  );
}

/**
 * Lit le **code métier** d'un problème (`{ code, ... }`), quand la passerelle en
 * a posé un. C'est le seul membre qui se teste : `title` et `detail` sont écrits
 * pour être lus, pas pour être comparés. Un statut seul ne dit pas la cause —
 * trois 409 différents ne se traitent pas de la même façon à l'écran.
 */
export function codeProbleme(corps: unknown): string | undefined {
  if (!estObjet(corps)) return undefined;
  const code = corps['code'];
  return typeof code === 'string' ? code : undefined;
}

/**
 * UT-04 (CA2) : porte le focus sur la première section concernée par une erreur
 * bloquante générique (BFF sans détail par champ), pour ne pas laisser
 * l'utilisateur sans repère.
 *
 * `cible` peut être l'élément `role="alert"` lui-même (rendu focusable via
 * `tabIndex={-1}`) ou tout conteneur de la section à mettre en avant. Sans
 * cible focusable, on ne fait rien (le `role="alert"` annonce déjà le message).
 */
export function focaliserSection(cible: HTMLElement | null | undefined): void {
  if (cible && typeof cible.focus === 'function') {
    cible.focus();
  }
}
