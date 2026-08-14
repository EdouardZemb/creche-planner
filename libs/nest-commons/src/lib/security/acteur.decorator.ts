import { createParamDecorator, type ExecutionContext } from '@nestjs/common';
import { acteurDepuisAssertion, type Acteur } from './acteur.js';
import type { RequeteAssertable } from './assertion-identite.guard.js';

/**
 * Injecte l'{@link Acteur} de la requête dans un paramètre de handler (lot 6,
 * `AM-45`) :
 *
 * ```ts
 * @Put(':id')
 * mettreAJour(@Param('id') id: string, @ActeurCourant() acteur: Acteur) { … }
 * ```
 *
 * **Pourquoi un paramètre et pas un contexte implicite.** La passerelle transporte
 * déjà l'identité par `AsyncLocalStorage` (`contexte-assertion.ts`) — elle n'a pas
 * le choix : ses clients HTTP sont des singletons qui ne voient pas la requête.
 * Ici le chemin est direct (contrôleur → service), et un acteur passé en argument
 * a trois propriétés qu'un stockage ambiant n'a pas : il est **visible** dans la
 * signature de la méthode qui écrit la piste d'audit, il ne peut pas se vider en
 * silence si le câblage change, et il est **constatable de l'extérieur** — la
 * porte `pnpm acteur` lit ces annotations dans les contrôleurs pour vérifier que
 * toute route auditée reçoit réellement son acteur.
 *
 * Ne lève jamais : une requête sans assertion vérifiée (mode legacy, ou assertion
 * refusée en observe-only) donne `{ type: 'inconnu' }`. La trace dira « inconnu »,
 * ce qui est l'information utile — cf. l'en-tête d'`acteur.ts`.
 */
export const ActeurCourant = createParamDecorator(
  (_donnees: unknown, ctx: ExecutionContext): Acteur => acteurDeContexte(ctx),
);

/**
 * Fabrique du décorateur, extraite pour être **testable directement** : le
 * `createParamDecorator` de Nest enferme sa fonction dans des métadonnées de
 * route, et un test qui la rejoue depuis ces métadonnées testerait Nest, pas la
 * lecture.
 */
export function acteurDeContexte(ctx: ExecutionContext): Acteur {
  return acteurDepuisAssertion(
    ctx.switchToHttp().getRequest<RequeteAssertable>().assertion,
  );
}
