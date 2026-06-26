import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { AdminGuard } from './admin.guard.js';
import { IdentiteGuard } from './identite.guard.js';
import { RateLimitGuard } from './rate-limit.guard.js';
import { TokenAuthGuard } from './token-auth.guard.js';

/**
 * Sécurité transverse de la gateway : limitation de débit, puis authentification
 * machine, puis identité du parent, puis rôle admin.
 *
 * Les gardes `APP_GUARD` s'exécutent dans l'ordre d'enregistrement :
 * 1. `RateLimitGuard` — **avant** tout, pour protéger d'un flood ;
 * 2. `TokenAuthGuard` — auth **machine** web→gateway (jeton partagé) ;
 * 3. `IdentiteGuard` — identité **parent** (Cloudflare Access B1), **observe-only**
 *    (PR5) : pose `request.identite`, journalise ce qu'il aurait refusé sur
 *    l'**appartenance** au foyer, mais ne refuse encore rien (enforcement PR7) ;
 * 4. `AdminGuard` — rôle **admin** (PR6, option b-ii) : sur les seules routes
 *    `@AdminSeulement()` (création de foyer, CRUD parents), 403 si l'identité
 *    n'est pas dans `ADMIN_EMAILS`. **Opt-in** : allowlist vide ⇒ inactif. Il
 *    s'exécute **après** `IdentiteGuard` car il lit `request.identite`.
 */
@Module({
  providers: [
    { provide: APP_GUARD, useClass: RateLimitGuard },
    { provide: APP_GUARD, useClass: TokenAuthGuard },
    { provide: APP_GUARD, useClass: IdentiteGuard },
    { provide: APP_GUARD, useClass: AdminGuard },
  ],
})
export class SecurityModule {}
