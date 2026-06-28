import {
  type CanActivate,
  type ExecutionContext,
  ForbiddenException,
  Injectable,
  Logger,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { loadConfig } from '../config.js';
import { ADMIN_KEY } from './admin.decorator.js';
import { estAdmin, estGatingAdminActif } from './admin.js';
import type { RequeteIdentifiable } from './identite.js';

/**
 * Guard de **rôle administrateur** (option b-ii, provisioning admin).
 *
 * S'applique **uniquement** aux routes marquées `@AdminSeulement()` (création de
 * foyer, CRUD parents) ; toute autre route passe sans contrôle. Il s'appuie sur
 * `request.identite` posée **en amont** par {@link IdentiteGuard} (Cloudflare
 * Access B1).
 *
 * **Opt-in (sécurité prod)** : si l'allowlist `ADMIN_EMAILS` est **vide**, le
 * gating est désactivé et la route passe — la prod actuelle (sans `ADMIN_EMAILS`,
 * sous `GATEWAY_AUTH_DISABLED=1`) reste donc **inchangée**, zéro 403 introduit.
 * Dès que l'allowlist est peuplée (déploiement PR8), un e-mail hors-liste — ou
 * une requête sans identité établie — reçoit un **403**.
 *
 * Ce guard ne couvre **que le rôle admin** ; le refus d'**appartenance** par
 * foyer (un parent accédant à un autre foyer) reste **observe-only** jusqu'à PR7.
 */
@Injectable()
export class AdminGuard implements CanActivate {
  private readonly logger = new Logger(AdminGuard.name);

  constructor(private readonly reflector: Reflector) {}

  canActivate(ctx: ExecutionContext): boolean {
    const adminSeulement = this.reflector.getAllAndOverride<boolean>(
      ADMIN_KEY,
      [ctx.getHandler(), ctx.getClass()],
    );
    if (!adminSeulement) {
      return true;
    }

    const { adminEmails } = loadConfig();
    // Opt-in : allowlist vide ⇒ gating désactivé (prod actuelle inchangée).
    if (!estGatingAdminActif(adminEmails)) {
      return true;
    }

    const req = ctx.switchToHttp().getRequest<RequeteIdentifiable>();
    const email = req.identite?.email;
    if (estAdmin(email, adminEmails)) {
      return true;
    }

    this.logger.warn(
      `accès admin refusé (403) : ${email ?? '(aucune identité)'} hors ADMIN_EMAILS`,
    );
    throw new ForbiddenException("action réservée à l'administrateur");
  }
}
