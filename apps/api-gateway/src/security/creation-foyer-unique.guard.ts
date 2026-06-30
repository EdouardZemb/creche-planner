import {
  type CanActivate,
  ConflictException,
  type ExecutionContext,
  Injectable,
  Logger,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { FoyerClient } from '../clients/foyer.client.js';
import { loadConfig } from '../config.js';
import { estAdmin } from './admin.js';
import { CREATION_FOYER_UNIQUE_KEY } from './creation-foyer-unique.decorator.js';
import type { RequeteIdentifiable } from './identite.js';

/**
 * Garde **« une seule création de foyer par utilisateur »** (besoin B, P5).
 *
 * S'applique **uniquement** aux routes marquées `@CreationFoyerUnique()` (la
 * création de foyer) ; toute autre route passe. Elle ouvre la **self-service de
 * la 1ʳᵉ création** (décision 1bis) en remplaçant l'ancien `@AdminSeulement()`
 * tout en empêchant les doublons :
 * - **identité absente** → passe (mode hérité — prod non exposée inchangée) ;
 * - **admin** (∈ `ADMIN_EMAILS`) → passe (création illimitée, provisioning) ;
 * - **non-admin** avec `foyersParEmail(email)` **non vide** → **409** (« vous avez
 *   déjà un foyer, modifiez-le ») ;
 * - **non-admin sans foyer** → passe (première création autorisée).
 *
 * Ce n'est pas une frontière de sécurité (l'appartenance relève d'`@FoyerScope`)
 * mais une garde d'unicité. **Fail-open** : si la résolution `foyersParEmail`
 * échoue (svc-foyer indisponible), on **laisse passer** plutôt que de bloquer une
 * première création légitime sur un incident transitoire — un doublon éventuel
 * est moins grave qu'un parent empêché de créer son foyer (esprit tolérant de
 * {@link MoiController}). L'admin bypass et l'isolation par foyer restent intacts.
 */
@Injectable()
export class CreationFoyerUniqueGuard implements CanActivate {
  private readonly logger = new Logger(CreationFoyerUniqueGuard.name);

  constructor(
    private readonly reflector: Reflector,
    private readonly foyers: FoyerClient,
  ) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const actif = this.reflector.getAllAndOverride<boolean>(
      CREATION_FOYER_UNIQUE_KEY,
      [ctx.getHandler(), ctx.getClass()],
    );
    if (!actif) {
      return true; // route non soumise à la garde « création unique »
    }

    const req = ctx.switchToHttp().getRequest<RequeteIdentifiable>();
    const email = req.identite?.email;
    if (email === undefined) {
      return true; // mode hérité : aucune identité établie → création libre
    }

    const { adminEmails } = loadConfig();
    if (estAdmin(email, adminEmails)) {
      return true; // provisioning admin : création illimitée
    }

    let existants: readonly string[];
    try {
      existants = await this.foyers.foyersParEmail(email);
    } catch (erreur) {
      // Résolution impossible : ne pas bloquer une 1ʳᵉ création légitime sur un
      // incident transitoire (fail-open, garde d'unicité ≠ frontière de sécurité).
      this.logger.warn(
        `création unique : résolution foyers impossible pour ${email}, ` +
          `création laissée passer : ${
            erreur instanceof Error ? erreur.message : String(erreur)
          }`,
      );
      return true;
    }

    if (existants.length > 0) {
      this.logger.warn(
        `création unique REFUSÉE (409) : ${email} possède déjà ` +
          `${existants.length} foyer(s)`,
      );
      throw new ConflictException('vous avez déjà un foyer, modifiez-le');
    }
    return true;
  }
}
