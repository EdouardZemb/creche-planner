import { Body, Controller, HttpCode, HttpStatus, Post } from '@nestjs/common';
import { AssertionPubliqueInterServices } from '@creche-planner/nest-commons';
import { ZodValidationPipe } from './foyer.dto.js';
import {
  consommerDesabonnementSchema,
  emettreJetonSchema,
  type ConsommerDesabonnementDto,
  type EmettreJetonDto,
} from './desabonnement.dto.js';
import {
  DesabonnementService,
  type JetonEmis,
} from './desabonnement.service.js';

/**
 * Endpoints du désabonnement one-click (RFC 8058, PR5). Deux usages :
 *
 * - `POST /api/desabonnement/jetons` — **interne** : `svc-notifications` demande un
 *   jeton lié à `(parent, type, canal)` à la composition du récap.
 * - `POST /api/desabonnement` — cible de l'endpoint **public** de la gateway :
 *   consomme le jeton (one-shot). `409` si couper ce canal rendrait un type de
 *   service injoignable (invariant §5.3), `400` (générique) si le jeton est
 *   invalide/expiré/déjà utilisé.
 */
@Controller('desabonnement')
export class DesabonnementController {
  constructor(private readonly desabonnement: DesabonnementService) {}

  @Post('jetons')
  @HttpCode(HttpStatus.CREATED)
  emettre(
    @Body(new ZodValidationPipe(emettreJetonSchema)) dto: EmettreJetonDto,
  ): Promise<JetonEmis> {
    return this.desabonnement.emettreJeton(dto);
  }

  // H5 : point d'entrée RGPD one-click, auto-authentifié par son propre jeton HMAC
  // et ouvert à un client de messagerie sans session → exempté d'assertion
  // inter-services. `POST /jetons` (interne) reste, lui, soumis à l'assertion.
  @AssertionPubliqueInterServices()
  @Post()
  @HttpCode(HttpStatus.NO_CONTENT)
  consommer(
    @Body(new ZodValidationPipe(consommerDesabonnementSchema))
    dto: ConsommerDesabonnementDto,
  ): Promise<void> {
    return this.desabonnement.consommer(dto.token);
  }
}
