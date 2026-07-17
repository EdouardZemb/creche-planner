// Traduction des erreurs HTTP/réseau du BFF en messages lisibles pour
// l'utilisateur. Le BFF renvoie 502 sur panne réseau / timeout / circuit ouvert
// et propage les 4xx (404, 409, 422…). On centralise ici la conversion pour
// éviter d'afficher des messages techniques bruts ("HTTP 502") à l'écran.

import { ApiError } from '../api/client';

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

/** Erreur de validation rattachée à un champ, telle que renvoyée par le BFF. */
export interface ErreurChamp {
  champ: string;
  message: string;
}

/**
 * Extrait les erreurs par champ d'un corps de réponse BFF (AQ-12 : implémentation
 * unique, partagée par les formulaires foyer et contrat). Le BFF renvoie un
 * tableau `[{ champ, message }]` quand la validation détaille les champs ;
 * toute autre forme (corps absent, objet, entrées partielles) donne `[]` et
 * l'appelant retombe sur le message global ([messageErreur]).
 */
export function extraireErreurs(corps: unknown): ErreurChamp[] {
  if (Array.isArray(corps)) {
    return corps.filter(
      (e): e is ErreurChamp =>
        typeof e === 'object' &&
        e !== null &&
        typeof (e as Record<string, unknown>)['champ'] === 'string' &&
        typeof (e as Record<string, unknown>)['message'] === 'string',
    );
  }
  return [];
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
