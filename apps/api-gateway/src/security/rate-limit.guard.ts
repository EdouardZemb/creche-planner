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
 * - L'état est purement en mémoire, **par instance** (perdu au redémarrage) : à
 *   remplacer par un store partagé le jour d'une réplication (`AM-16`).
 * - La clé est `req.ip`, qui ne désigne le **client** que si `trust proxy` est
 *   réglé sur la topologie réelle — c'est fait dans `app.config.ts` depuis
 *   `RATE_LIMIT_PROXY_HOPS`. Sans lui, toutes les requêtes passant par un
 *   reverse-proxy partageaient une seule fenêtre (AN-15).
 * - Les buckets **vidés** par la purge de fenêtre sont **retirés** de la Map :
 *   sans cela elle croît indéfiniment, une entrée par clé jamais revue. Ce n'est
 *   pas cosmétique — une fois la clé devenue l'IP cliente (AN-15), c'est
 *   l'appelant qui choisit combien d'entrées créer (AN-19).
 */
@Injectable()
export class RateLimitGuard implements CanActivate {
  /** Horodatages (ms) des requêtes récentes, par clé client. */
  private readonly hits = new Map<string, number[]>();

  /** Instant (ms) du prochain balayage d'élagage — au plus un par fenêtre. */
  private prochainElagage = 0;

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

    const http = ctx.switchToHttp();
    const req = http.getRequest<{
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
      // `Retry-After` (RFC 6585 §4) : le client sait quand réessayer au lieu de
      // marteler — l'instant où le plus ancien hit de la fenêtre en sortira.
      const plusAncien = recents[0] ?? now;
      const attenteSecondes = Math.max(
        1,
        Math.ceil((plusAncien + fenetreMs - now) / 1000),
      );
      http
        .getResponse<{
          setHeader?: (nom: string, valeur: string) => void;
        }>()
        .setHeader?.('Retry-After', String(attenteSecondes));
      throw new HttpException('trop de requêtes', HttpStatus.TOO_MANY_REQUESTS);
    }

    recents.push(now);
    this.hits.set(cle, recents);
    this.elaguer(now, seuil, fenetreMs);

    return true;
  }

  /**
   * Retire les clés dont **toutes** les entrées sont sorties de la fenêtre. La Map
   * ne décroissait jamais : chaque clé vue une fois y restait pour la durée de vie
   * du processus (AN-19).
   *
   * Le balayage est **amorti** — au plus un par fenêtre, pas un par requête : un
   * balayage à chaque appel serait en O(clients actifs) par requête, donc quadratique
   * sous la charge distribuée que ce guard est précisément censé encaisser. Entre
   * deux balayages la Map peut dépasser les clients actifs, mais d'au plus une
   * fenêtre de trafic — bornée, contrairement à l'ancienne croissance monotone.
   */
  private elaguer(now: number, seuil: number, fenetreMs: number): void {
    if (now < this.prochainElagage) {
      return;
    }
    this.prochainElagage = now + fenetreMs;
    for (const [cle, horodatages] of this.hits) {
      const dernier = horodatages.at(-1);
      if (dernier === undefined || dernier <= seuil) {
        this.hits.delete(cle);
      }
    }
  }
}
