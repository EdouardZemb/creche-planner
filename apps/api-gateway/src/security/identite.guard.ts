import {
  type CanActivate,
  type ExecutionContext,
  Injectable,
  Logger,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { loadConfig } from '../config.js';
import {
  ENTETE_DEV_EMAIL,
  ENTETE_JWT_CF,
  emailDepuisJwtCf,
  entete,
  jwksCloudflare,
  type RequeteIdentifiable,
} from './identite.js';
import { PUBLIC_KEY } from './public.decorator.js';

/**
 * Guard d'**identité** (option B1, Cloudflare Access).
 *
 * Il établit l'identité du parent et la pose en `request.identite`, mais
 * **n'autorise ni ne refuse aucune route** : la décision d'accès par foyer relève
 * du {@link AppartenanceGuard} (PR7), qui s'exécute après lui. Ce guard est
 * strictement additif et **ne lève jamais** (toute erreur de validation est
 * avalée et journalisée).
 *
 * Sources d'identité (par priorité) :
 * 1. **JWT Cloudflare Access** (`Cf-Access-Jwt-Assertion`) validé contre le JWKS
 *    du team domain + issuer + `aud` — la seule source de confiance en prod. On
 *    ne fait **jamais** confiance à un en-tête e-mail brut (spoofable).
 * 2. **Dev** : `X-Dev-User-Email`, accepté **uniquement hors production**
 *    (`config.identite.devHeaderAutorise`), pour développer sans Cloudflare.
 *
 * L'auth **machine** web→gateway reste assurée par {@link TokenAuthGuard}.
 */
@Injectable()
export class IdentiteGuard implements CanActivate {
  private readonly logger = new Logger(IdentiteGuard.name);

  constructor(private readonly reflector: Reflector) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const estPublic = this.reflector.getAllAndOverride<boolean>(PUBLIC_KEY, [
      ctx.getHandler(),
      ctx.getClass(),
    ]);
    if (estPublic) {
      return true;
    }

    const req = ctx.switchToHttp().getRequest<RequeteIdentifiable>();
    const email = await this.resoudreEmail(req);
    if (email !== undefined) {
      req.identite = { email };
    }

    // Pose l'identité et laisse TOUJOURS passer : l'autorisation par foyer est
    // décidée par AppartenanceGuard (en aval).
    return true;
  }

  /**
   * Résout l'e-mail vérifié de la requête, ou `undefined` si aucune identité
   * n'a pu être établie. Ne lève jamais : un JWT invalide est journalisé puis
   * ignoré.
   */
  private async resoudreEmail(
    req: RequeteIdentifiable,
  ): Promise<string | undefined> {
    const { identite } = loadConfig();

    const jwt = entete(req.headers, ENTETE_JWT_CF);
    if (jwt !== undefined && identite.cfTeamDomain && identite.cfAud) {
      try {
        return await emailDepuisJwtCf(
          jwt,
          { issuer: identite.cfTeamDomain, audience: identite.cfAud },
          jwksCloudflare(identite.cfTeamDomain),
        );
      } catch (erreur) {
        this.logger.warn(
          `JWT Cloudflare Access invalide (ignoré) : ${messageErreur(erreur)}`,
        );
        return undefined;
      }
    }

    if (identite.devHeaderAutorise) {
      const devEmail = entete(req.headers, ENTETE_DEV_EMAIL)?.trim();
      if (devEmail) {
        this.logger.debug(
          `identité de dev injectée via ${ENTETE_DEV_EMAIL} : ${devEmail}`,
        );
        return devEmail;
      }
    }

    return undefined;
  }
}

/** Message d'erreur lisible quel que soit le type levé. */
function messageErreur(erreur: unknown): string {
  return erreur instanceof Error ? erreur.message : String(erreur);
}
