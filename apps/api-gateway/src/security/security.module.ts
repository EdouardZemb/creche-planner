import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { RateLimitGuard } from './rate-limit.guard.js';
import { TokenAuthGuard } from './token-auth.guard.js';

/**
 * Sécurité transverse de la gateway : limitation de débit puis authentification.
 *
 * Les gardes `APP_GUARD` s'exécutent dans l'ordre d'enregistrement, donc on
 * place `RateLimitGuard` **avant** `TokenAuthGuard` afin de protéger le chemin
 * d'authentification d'un flood de requêtes.
 */
@Module({
  providers: [
    { provide: APP_GUARD, useClass: RateLimitGuard },
    { provide: APP_GUARD, useClass: TokenAuthGuard },
  ],
})
export class SecurityModule {}
