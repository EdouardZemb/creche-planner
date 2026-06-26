import {
  type CanActivate,
  type ExecutionContext,
  Injectable,
  Logger,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { FoyerClient } from '../clients/foyer.client.js';
import { loadConfig } from '../config.js';
import {
  ENTETE_DEV_EMAIL,
  ENTETE_JWT_CF,
  emailDepuisJwtCf,
  entete,
  foyerIdDemande,
  jwksCloudflare,
  type RequeteIdentifiable,
} from './identite.js';
import { PUBLIC_KEY } from './public.decorator.js';

/**
 * Guard d'**identité** (option B1, Cloudflare Access) — **OBSERVE-ONLY (PR5)**.
 *
 * Il établit l'identité du parent et la pose en `request.identite`, mais
 * **n'autorise ni ne refuse aucune route** : il se contente de **journaliser**
 * ce qu'il *aurait* refusé (résolution `email → {foyers}` comparée au `foyerId`
 * demandé). L'enforcement 403 viendra en PR7, derrière un flag, après back-fill.
 *
 * Sources d'identité (par priorité) :
 * 1. **JWT Cloudflare Access** (`Cf-Access-Jwt-Assertion`) validé contre le JWKS
 *    du team domain + issuer + `aud` — la seule source de confiance en prod. On
 *    ne fait **jamais** confiance à un en-tête e-mail brut (spoofable).
 * 2. **Dev** : `X-Dev-User-Email`, accepté **uniquement hors production**
 *    (`config.identite.devHeaderAutorise`), pour développer sans Cloudflare.
 *
 * L'auth **machine** web→gateway reste assurée par {@link TokenAuthGuard} ; ce
 * guard est strictement additif et ne lève jamais (toute erreur est avalée et
 * journalisée — observe-only).
 */
@Injectable()
export class IdentiteGuard implements CanActivate {
  private readonly logger = new Logger(IdentiteGuard.name);

  constructor(
    private readonly reflector: Reflector,
    private readonly foyers: FoyerClient,
  ) {}

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
      await this.observerAppartenance(email, req);
    }

    // OBSERVE-ONLY : on laisse TOUJOURS passer (l'enforcement est en PR7).
    return true;
  }

  /**
   * Résout l'e-mail vérifié de la requête, ou `undefined` si aucune identité
   * n'a pu être établie. Ne lève jamais : un JWT invalide est journalisé puis
   * ignoré (observe-only).
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
          `JWT Cloudflare Access invalide (ignoré, observe-only) : ${messageErreur(erreur)}`,
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

  /**
   * OBSERVE-ONLY : compare le `foyerId` demandé à l'ensemble des foyers dont
   * l'e-mail est parent actif, et **journalise** ce qu'on aurait refusé. Aucune
   * décision d'accès n'est prise. La résolution peut échouer (svc-foyer
   * indisponible) → journalisée, sans impact.
   */
  private async observerAppartenance(
    email: string,
    req: RequeteIdentifiable,
  ): Promise<void> {
    const foyerId = foyerIdDemande(req);
    if (foyerId === undefined) {
      return;
    }
    try {
      const autorises = await this.foyers.foyersParEmail(email);
      if (autorises.includes(foyerId)) {
        this.logger.debug(
          `observe-only : accès foyer ${foyerId} autorisé pour ${email}`,
        );
      } else {
        this.logger.warn(
          `observe-only : AURAIT REFUSÉ ${email} → foyer ${foyerId} ` +
            `(foyers autorisés : ${autorises.length > 0 ? autorises.join(', ') : 'aucun'})`,
        );
      }
    } catch (erreur) {
      this.logger.warn(
        `observe-only : résolution foyers impossible pour ${email} : ${messageErreur(erreur)}`,
      );
    }
  }
}

/** Message d'erreur lisible quel que soit le type levé. */
function messageErreur(erreur: unknown): string {
  return erreur instanceof Error ? erreur.message : String(erreur);
}
