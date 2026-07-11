import { HttpException } from '@nestjs/common';
import { ErreurAmont } from '../clients/appel-resilient.js';

/**
 * Déduit un statut HTTP à propager depuis l'erreur d'un client résilient. Les
 * clients lèvent `Error('HTTP <code>')` sur réponse non-2xx ; on **réémet le même
 * code** (un 404 amont reste un 404). Pour une panne réseau, un timeout ou un
 * circuit ouvert (pas de code HTTP), on renvoie **502 Bad Gateway** : la gateway
 * a échoué à joindre un service aval.
 */
function statutDepuisErreur(erreur: unknown): number {
  const message = erreur instanceof Error ? erreur.message : '';
  const correspondance = /^HTTP (\d{3})$/.exec(message);
  return correspondance ? Number(correspondance[1]) : 502;
}

/**
 * Exécute un appel aval et **traduit** toute erreur en `HttpException` portant le
 * statut dérivé ci-dessus, afin que le BFF ne masque pas une erreur amont
 * derrière un 500 générique.
 */
export async function relayer<T>(operation: () => Promise<T>): Promise<T> {
  try {
    return await operation();
  } catch (erreur) {
    // Erreur amont **4xx** au corps capturé (opt-in `FoyerClient`) : on réémet le
    // corps amont TEL QUEL (ex. 409 `{ statusCode, code, message }` → le front lit
    // `code`). On préserve les sémantiques 5xx / réseau / circuit ci-dessous.
    if (erreur instanceof ErreurAmont && erreur.status < 500) {
      throw new HttpException(
        erreur.corps as string | Record<string, unknown>,
        erreur.status,
      );
    }
    const statut = statutDepuisErreur(erreur);
    throw new HttpException(
      {
        statut,
        message: 'erreur du service amont',
        detail: erreur instanceof Error ? erreur.message : String(erreur),
      },
      statut,
    );
  }
}
