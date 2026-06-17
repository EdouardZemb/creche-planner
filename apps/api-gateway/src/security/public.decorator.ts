import { SetMetadata } from '@nestjs/common';

/** Clé de métadonnée marquant une route comme publique (sans auth). */
export const PUBLIC_KEY = 'gateway:public';

/**
 * Marque une route (ou un contrôleur entier) comme publique : le
 * {@link TokenAuthGuard} la laisse passer sans vérifier le jeton d'API.
 * Utilisé pour le health-check et l'exposition OpenAPI.
 */
export const Public = () => SetMetadata(PUBLIC_KEY, true);
