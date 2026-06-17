import { HttpException } from '@nestjs/common';

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
