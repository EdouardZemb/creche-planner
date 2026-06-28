import { SetMetadata } from '@nestjs/common';
import type { SourceFoyer } from './foyer-scope.js';

/** Clé de métadonnée portant la source du `foyerId` d'une route. */
export const FOYER_SCOPE_KEY = 'gateway:foyer-scope';

/**
 * Déclare **où trouver le `foyerId`** d'une route, pour que le guard
 * d'appartenance (PR7) puisse contrôler l'accès par foyer. Marque la route comme
 * **scopée foyer** : son absence signifie « route non soumise à l'autorisation
 * par foyer ». C'est l'inventaire exhaustif des routes à protéger, vivant **dans
 * le code** des contrôleurs. Voir {@link SourceFoyer} pour les formes acceptées.
 *
 * @example
 *   @Get(':id') @FoyerScope('param:id') lire(...) {}
 *   @Get() @FoyerScope('query:foyer') lister(...) {}
 *   @Put(':id') @FoyerScope('contrat:id') modifier(...) {}
 */
export const FoyerScope = (source: SourceFoyer) =>
  SetMetadata(FOYER_SCOPE_KEY, source);
