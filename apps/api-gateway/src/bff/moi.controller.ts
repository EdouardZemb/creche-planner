import { Controller, Get, Logger, Req } from '@nestjs/common';
import { FoyerClient } from '../clients/foyer.client.js';
import { loadConfig } from '../config.js';
import { estAdmin, estGatingAdminActif } from '../security/admin.js';
import type { RequeteIdentifiable } from '../security/identite.js';

/**
 * Identité courante du client (Cloudflare Access B1) et ses droits, résolus
 * **côté serveur** : e-mail vérifié, statut admin, ensemble des foyers autorisés.
 * Le web s'en sert pour gater l'écran de création (admin) et **borner** la
 * sélection de foyer à l'ensemble autorisé (0/1/N).
 */
interface MoiVue {
  /** E-mail vérifié de l'identité, ou `null` si aucune identité n'est établie. */
  readonly email: string | null;
  /**
   * `true` si l'e-mail est administrateur. **Permissif** quand le gating admin
   * est inactif (`ADMIN_EMAILS` vide) : tout le monde est « admin » — la prod
   * actuelle conserve ainsi l'accès à la création de foyer.
   */
  readonly admin: boolean;
  /** Ids des foyers dont l'e-mail est parent **actif** (vide sans identité). */
  readonly foyers: readonly string[];
}

/**
 * Façade BFF `/api/v1/moi` : « qui suis-je ? ». Lecture seule, **non gardée**
 * par l'admin (toute identité — ou aucune — peut l'interroger). Tolérante aux
 * pannes : si la résolution `email → {foyers}` échoue (svc-foyer indisponible),
 * on renvoie une liste vide plutôt que d'échouer (esprit observe-only).
 */
@Controller({ path: 'moi', version: '1' })
export class MoiController {
  private readonly logger = new Logger(MoiController.name);

  constructor(private readonly foyers: FoyerClient) {}

  @Get()
  async lire(@Req() req: RequeteIdentifiable): Promise<MoiVue> {
    const { adminEmails } = loadConfig();
    const email = req.identite?.email ?? null;
    // Permissif si le gating est inactif (allowlist vide) : prod actuelle ouverte.
    const admin = estGatingAdminActif(adminEmails)
      ? estAdmin(email ?? undefined, adminEmails)
      : true;

    let foyers: readonly string[] = [];
    if (email !== null) {
      try {
        foyers = await this.foyers.foyersParEmail(email);
      } catch (erreur) {
        this.logger.warn(
          `résolution foyers impossible pour ${email} : ${
            erreur instanceof Error ? erreur.message : String(erreur)
          }`,
        );
      }
    }

    return { email, admin, foyers };
  }
}
