import { SetMetadata, type CustomDecorator } from '@nestjs/common';

/** Clé de métadonnée lue par `LocationInterceptor` et par la garde de couverture. */
export const RESSOURCE_CREEE_KEY = 'ressource_creee';

/**
 * Extrait l'identifiant de la ressource créée depuis la vue rendue par le
 * handler. C'est un **extracteur**, pas un gabarit d'URL : le chemin de la
 * ressource se dérive de l'URL de la requête (cf. `LocationInterceptor`), qui
 * est la seule source qui ne puisse pas se désaligner de la route réellement
 * servie.
 */
export type IdentifiantCree<T> = (vue: T) => string | undefined;

/**
 * Marque une route de **création** dont la ressource a une URI adressable :
 * l'intercepteur pose alors l'en-tête `Location` de son 201 (RFC 9110 §10.2.2).
 *
 * Le décorateur porte deux rôles, comme `@ActeurCourant()` au lot 6 : il fournit
 * ce qu'il faut pour agir, et il rend l'intention **constatable de l'extérieur**.
 * Une écriture d'en-tête au fond d'un handler serait invisible en métadonnée ;
 * ici, la garde `openapi.couverture.spec.ts` peut exiger que le contrat déclare
 * un `Location` exactement là où le code en pose un — le document OpenAPI est
 * une troisième copie que rien ne tenait sémantiquement (leçon du lot 6).
 *
 * Toutes les créations n'en portent pas : quatre 201 de la passerelle ne créent
 * aucune ressource adressable (publications du référentiel, envoi d'un
 * récapitulatif). Ne pas poser le décorateur y est l'écart assumé, et la garde
 * en tient la liste.
 */
export const RessourceCreee = <T>(
  identifiant: IdentifiantCree<T>,
): CustomDecorator => SetMetadata(RESSOURCE_CREEE_KEY, identifiant);
