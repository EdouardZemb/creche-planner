import {
  type CanActivate,
  type ExecutionContext,
  HttpException,
  HttpStatus,
  Injectable,
  Optional,
} from '@nestjs/common';
import { loadConfig } from '../config.js';

/**
 * Garde de limitation de débit (rate-limit) en mémoire, par client.
 *
 * Implémente une fenêtre glissante simple : on conserve, par clé client, les
 * horodatages (ms) des requêtes récentes. À chaque appel on purge les entrées
 * sorties de la fenêtre `fenetreMs` ; si le client a déjà atteint
 * `maxRequetes` requêtes dans la fenêtre, on renvoie un 429.
 *
 * Remarques :
 * - Les routes `@Public()` sont **aussi** limitées (le health-check peut être
 *   spammé), donc aucune exemption ici.
 * - L'état est purement en mémoire (perdu au redémarrage). On élague les
 *   buckets vides pour éviter une croissance non bornée de la Map.
 */
@Injectable()
export class RateLimitGuard implements CanActivate {
  /** Horodatages (ms) des requêtes récentes, par clé client. */
  private readonly hits = new Map<string, number[]>();

  /**
   * Horloge injectable (testabilité). `@Optional()` : Nest ne tente pas de
   * résoudre ce paramètre via le conteneur (ce n'est pas un provider) et passe
   * `undefined`, ce qui active la valeur par défaut `Date.now`.
   */
  constructor(
    @Optional() private readonly maintenant: () => number = Date.now,
  ) {}

  canActivate(ctx: ExecutionContext): boolean {
    const { rateLimit } = loadConfig();
    const { fenetreMs, maxRequetes } = rateLimit;

    const req = ctx.switchToHttp().getRequest<{
      ip?: string;
      socket?: { remoteAddress?: string };
    }>();
    const cle = req.ip ?? req.socket?.remoteAddress ?? 'inconnu';

    const now = this.maintenant();
    const seuil = now - fenetreMs;

    const precedents = this.hits.get(cle) ?? [];
    const recents = precedents.filter((t) => t > seuil);

    if (recents.length >= maxRequetes) {
      // On replace les entrées purgées pour ne pas fuiter, puis on rejette.
      this.hits.set(cle, recents);
      throw new HttpException('trop de requêtes', HttpStatus.TOO_MANY_REQUESTS);
    }

    recents.push(now);
    this.hits.set(cle, recents);

    return true;
  }
}
