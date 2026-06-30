import { SetMetadata } from '@nestjs/common';

/** Clé de métadonnée marquant une route soumise à la garde « création unique ». */
export const CREATION_FOYER_UNIQUE_KEY = 'gateway:creation-foyer-unique';

/**
 * Marque la route de **création de foyer** comme soumise à la garde
 * **« une seule création par utilisateur »** (besoin B, décision 1bis) : le
 * {@link CreationFoyerUniqueGuard} refuse (**409**) une **2ᵉ** création par une
 * identité **non-admin** qui possède déjà ≥1 foyer (`foyersParEmail` non vide).
 *
 * Sémantique voulue, alignée sur le reste de `security/` :
 * - **admin** (∈ `ADMIN_EMAILS`) → **illimité** (provisioning pour autrui) ;
 * - **identité absente** → **mode hérité**, inchangé (la prod non exposée
 *   `GATEWAY_AUTH_DISABLED=1` sans Cloudflare crée toujours librement) ;
 * - **non-admin sans foyer** → laisse passer (self-service de la 1ʳᵉ création).
 *
 * Ce n'est **pas** une frontière de sécurité (l'isolation par foyer relève de
 * `@FoyerScope`/{@link AppartenanceGuard}) mais une garde d'**unicité/UX** : on
 * empêche un doublon et on oriente vers l'édition.
 */
export const CreationFoyerUnique = () =>
  SetMetadata(CREATION_FOYER_UNIQUE_KEY, true);
