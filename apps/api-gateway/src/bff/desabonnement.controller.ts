import {
  BadRequestException,
  Controller,
  HttpCode,
  HttpStatus,
  Post,
  Query,
} from '@nestjs/common';
import { FoyerClient } from '../clients/foyer.client.js';
import { Public } from '../security/public.decorator.js';
import { relayer } from './relais.js';

/**
 * Endpoint **public** de désabonnement one-click (RFC 8058, PR5).
 *
 * `@Public()` : hors `IdentiteGuard`/`FoyerScope` (aucune session — le lien vient
 * d'un e-mail) mais **toujours** derrière le `RateLimitGuard` global (l'ordre des
 * `APP_GUARD` place la limitation de débit en premier, sans exemption des routes
 * publiques). Le jeton signé opaque (`?token=…`) est le seul paramètre : pas
 * d'e-mail, pas d'id ⇒ **aucune énumération** possible. `svc-foyer` valide et
 * consomme le jeton ; on **réémet son statut** : `204` succès, `409` si couper ce
 * canal rendrait un type de service injoignable (dernier canal), `400` (générique)
 * si le jeton est invalide/expiré/déjà utilisé.
 *
 * Le corps `List-Unsubscribe=One-Click` envoyé par les clients de messagerie
 * (RFC 8058) est ignoré : le jeton est lu depuis la **query string**, seule
 * compatible avec le POST one-click (dont le corps est imposé par la RFC).
 */
@Controller({ path: 'desabonnement', version: '1' })
export class DesabonnementController {
  constructor(private readonly foyers: FoyerClient) {}

  @Public()
  @Post()
  @HttpCode(HttpStatus.NO_CONTENT)
  async desabonner(@Query('token') token?: string): Promise<void> {
    if (token === undefined || token.trim() === '') {
      // Jeton absent : traité comme un lien invalide (message générique).
      throw new BadRequestException('lien de désabonnement invalide ou expiré');
    }
    await relayer(() => this.foyers.desabonner(token));
  }
}
