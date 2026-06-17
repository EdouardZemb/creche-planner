import { Controller, Get } from '@nestjs/common';
import { gatewayOpenApiDocument } from '@creche-planner/contracts-kernel';
import { Public } from '../security/public.decorator.js';

/**
 * Publie la **spécification OpenAPI** de la gateway (`GET /api/openapi.json`).
 * Route publique (sans jeton) : sert de documentation contractuelle au front et
 * aux outils. Le document est versionné dans `libs/contracts`.
 */
@Public()
@Controller()
export class OpenApiController {
  @Get('openapi.json')
  document(): unknown {
    return gatewayOpenApiDocument;
  }
}
