import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { IdentiteGuard } from './identite.guard.js';
import { RateLimitGuard } from './rate-limit.guard.js';
import { TokenAuthGuard } from './token-auth.guard.js';

/**
 * Sécurité transverse de la gateway : limitation de débit, puis authentification
 * machine, puis identité du parent.
 *
 * Les gardes `APP_GUARD` s'exécutent dans l'ordre d'enregistrement :
 * 1. `RateLimitGuard` — **avant** tout, pour protéger d'un flood ;
 * 2. `TokenAuthGuard` — auth **machine** web→gateway (jeton partagé) ;
 * 3. `IdentiteGuard` — identité **parent** (Cloudflare Access B1), **observe-only
 *    en PR5** : pose `request.identite`, journalise ce qu'il aurait refusé, mais
 *    n'autorise/ne refuse encore rien (enforcement en PR7).
 */
@Module({
  providers: [
    { provide: APP_GUARD, useClass: RateLimitGuard },
    { provide: APP_GUARD, useClass: TokenAuthGuard },
    { provide: APP_GUARD, useClass: IdentiteGuard },
  ],
})
export class SecurityModule {}
