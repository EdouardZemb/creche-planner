import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { AdminGuard } from './admin.guard.js';
import { AppartenanceGuard } from './appartenance.guard.js';
import { CreationFoyerUniqueGuard } from './creation-foyer-unique.guard.js';
import { IdentiteGuard } from './identite.guard.js';
import { RateLimitGuard } from './rate-limit.guard.js';
import { TokenAuthGuard } from './token-auth.guard.js';

/**
 * Sécurité transverse de la gateway : limitation de débit, puis authentification
 * machine, puis identité du parent, puis rôle admin, puis appartenance au foyer,
 * puis unicité de la création de foyer.
 *
 * Les gardes `APP_GUARD` s'exécutent dans l'ordre d'enregistrement :
 * 1. `RateLimitGuard` — **avant** tout, pour protéger d'un flood ;
 * 2. `TokenAuthGuard` — auth **machine** web→gateway (jeton partagé) ;
 * 3. `IdentiteGuard` — identité **parent** (Cloudflare Access B1) : pose
 *    `request.identite`, ne refuse rien ;
 * 4. `AdminGuard` — rôle **admin** (PR6, option b-ii) : sur les seules routes
 *    `@AdminSeulement()` (création de foyer, CRUD parents), 403 si l'identité
 *    n'est pas dans `ADMIN_EMAILS`. **Opt-in** : allowlist vide ⇒ inactif. Il
 *    s'exécute **après** `IdentiteGuard` car il lit `request.identite` ;
 * 5. `AppartenanceGuard` — **autorisation par foyer** (PR7) : sur les routes
 *    `@FoyerScope(...)`, 403 si le foyer ciblé n'est pas dans l'ensemble autorisé
 *    de l'identité. **Derrière le flag `FOYER_AUTHZ_ENFORCE`** (observe-only par
 *    défaut). Admin bypass. Il lit `request.identite` ;
 * 6. `CreationFoyerUniqueGuard` — **« une seule création par utilisateur »** (P5,
 *    besoin B) : sur la seule route `@CreationFoyerUnique()` (création de foyer),
 *    **409** si une identité non-admin possède déjà ≥1 foyer. Admin illimité,
 *    identité absente = mode hérité. Il lit `request.identite` (donc après
 *    `IdentiteGuard`).
 */
@Module({
  providers: [
    { provide: APP_GUARD, useClass: RateLimitGuard },
    { provide: APP_GUARD, useClass: TokenAuthGuard },
    { provide: APP_GUARD, useClass: IdentiteGuard },
    { provide: APP_GUARD, useClass: AdminGuard },
    { provide: APP_GUARD, useClass: AppartenanceGuard },
    { provide: APP_GUARD, useClass: CreationFoyerUniqueGuard },
  ],
})
export class SecurityModule {}
