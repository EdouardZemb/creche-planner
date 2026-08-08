import { timingSafeEqual } from 'node:crypto';
import {
  type CanActivate,
  type ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { loadConfig } from '../config.js';
import { PUBLIC_KEY } from './public.decorator.js';

/**
 * Garde d'authentification par jeton d'API (schéma Bearer).
 *
 * Comportement :
 * - Une route marquée `@Public()` (au niveau handler ou classe) passe sans
 *   vérification.
 * - **Si `GATEWAY_TOKEN` n'est pas défini, l'authentification est désactivée**
 *   et toutes les requêtes passent : confort de dev local. En production cette
 *   absence doit être explicite : `verifierConfigProduction()` (config.ts)
 *   refuse le démarrage sans jeton ni `GATEWAY_AUTH_DISABLED=1` (AQ-01).
 * - Sinon, on exige l'en-tête `authorization: 'Bearer <jeton>'` et le jeton
 *   doit correspondre exactement à `authToken`.
 */
@Injectable()
export class TokenAuthGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(ctx: ExecutionContext): boolean {
    const estPublic = this.reflector.getAllAndOverride<boolean>(PUBLIC_KEY, [
      ctx.getHandler(),
      ctx.getClass(),
    ]);
    if (estPublic) {
      return true;
    }

    const { authToken } = loadConfig();
    // Jeton non configuré → auth désactivée (dev local).
    if (authToken === undefined) {
      return true;
    }

    const req = ctx.switchToHttp().getRequest<{
      headers: Record<string, string | string[] | undefined>;
    }>();
    const brut = req.headers['authorization'];
    const entete = Array.isArray(brut) ? brut[0] : brut;

    const prefixe = 'Bearer ';
    if (
      entete === undefined ||
      !entete.startsWith(prefixe) ||
      !egalTempsConstant(entete.slice(prefixe.length), authToken)
    ) {
      throw new UnauthorizedException("jeton d'API manquant ou invalide");
    }

    return true;
  }
}

/**
 * Égalité de deux secrets en **temps constant**. `!==` révèle, par le temps de
 * réponse, la longueur du préfixe commun — c'est peu exploitable au travers d'un
 * réseau, mais le dépôt compare déjà ses autres secrets ainsi (`verifierJeton`,
 * `verifierAssertion`) et l'incohérence n'avait pas de raison d'être.
 *
 * La comparaison de **longueur** reste, elle, à temps variable : `timingSafeEqual`
 * exige des tampons de même taille, et la longueur d'un jeton n'est pas le secret.
 */
function egalTempsConstant(fourni: string, attendu: string): boolean {
  const a = Buffer.from(fourni, 'utf8');
  const b = Buffer.from(attendu, 'utf8');
  return a.length === b.length && timingSafeEqual(a, b);
}
