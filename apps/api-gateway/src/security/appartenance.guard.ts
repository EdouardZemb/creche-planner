import {
  type CanActivate,
  type ExecutionContext,
  ForbiddenException,
  Injectable,
  Logger,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { metrics } from '@opentelemetry/api';
import { FoyerClient } from '../clients/foyer.client.js';
import { PlanificationClient } from '../clients/planification.client.js';
import { loadConfig } from '../config.js';
import { estAdmin } from './admin.js';
import { FOYER_SCOPE_KEY } from './foyer-scope.decorator.js';
import { extraireRefFoyer, type SourceFoyer } from './foyer-scope.js';
import type { RequeteIdentifiable } from './identite.js';

/**
 * Compteur OTel des refus d'appartenance foyer, exporté en Prometheus sous
 * `gateway_authz_refus_total{decision, motif}` (le label `service.name` est ajouté
 * par le collector). Si aucun `MeterProvider` n'est enregistré, l'API OTel est un
 * no-op silencieux. Modèle d'émission : `apps/svc-tarification/src/fallback/planification.client.ts`.
 *
 * - `decision` : `refuse` (mode enforce, 403 réel) ou `aurait_refuse` (observe-only, laissé passer).
 * - `motif` : `hors_scope` (foyer hors ensemble autorisé) ou `resolution_impossible`
 *   (svc-foyer/svc-planification injoignable, contrat introuvable).
 *
 * En observe-only (prod actuelle), `aurait_refuse` mesure ce que l'enforce refuserait :
 * un flux non nul avant bascule signale des faux positifs à investiguer (cf. runbook).
 */
const meterAuthz = metrics.getMeter('api-gateway.authz');
const compteurRefus = meterAuthz.createCounter('gateway_authz_refus_total', {
  description:
    "Refus d'appartenance foyer par la gateway (par décision réelle/observe et par motif).",
});

/**
 * Guard d'**appartenance au foyer** (option B, cœur de l'isolation par foyer, PR7).
 *
 * Sur **toute** route déclarée `@FoyerScope(...)`, il dérive le `foyerId` ciblé
 * (param / query / corps, ou résolution `contrat → foyer` via `svc-planification`),
 * le compare à l'ensemble des foyers dont l'**e-mail vérifié** de l'identité
 * (Cloudflare Access B1, posé par {@link IdentiteGuard}) est parent **actif**
 * (`FoyerClient.foyersParEmail`), et refuse (403) l'accès hors de cet ensemble.
 *
 * **Derrière un flag (`FOYER_AUTHZ_ENFORCE`, opt-in)** — `config.foyerAuthzEnforce` :
 * - **désactivé (défaut)** : **observe-only**, journalise « AURAIT REFUSÉ » mais
 *   laisse passer (comportement legacy, prod actuelle inchangée) ;
 * - **activé** (après back-fill PR6) : **refus réel (403)**.
 *
 * Garde-fous anti-verrouillage :
 * - **route non scopée** (`@FoyerScope` absent) → laisse passer ;
 * - **aucune identité établie** → laisse passer (l'auth machine + Cloudflare
 *   Access au bord restent les barrières ; décision : ne pas verrouiller un
 *   déploiement où l'identité n'est pas encore câblée) ;
 * - **admin** (e-mail ∈ `ADMIN_EMAILS`) → **bypass** (provisioning, PR6).
 *
 * **Fail-closed** : en mode enforce, si la résolution échoue (svc-foyer /
 * svc-planification indisponible, contrat introuvable), on **refuse** plutôt que
 * d'ouvrir un trou — un contrôle d'accès qui échoue ouvert n'en est pas un. En
 * observe-only, l'échec est seulement journalisé.
 */
@Injectable()
export class AppartenanceGuard implements CanActivate {
  private readonly logger = new Logger(AppartenanceGuard.name);

  constructor(
    private readonly reflector: Reflector,
    private readonly foyers: FoyerClient,
    private readonly planification: PlanificationClient,
  ) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const source = this.reflector.getAllAndOverride<SourceFoyer | undefined>(
      FOYER_SCOPE_KEY,
      [ctx.getHandler(), ctx.getClass()],
    );
    if (!source) {
      return true; // route non soumise à l'autorisation par foyer
    }

    const req = ctx.switchToHttp().getRequest<RequeteIdentifiable>();
    const email = req.identite?.email;
    if (email === undefined) {
      // Sans identité : on délègue aux barrières existantes (non-verrouillant).
      return true;
    }

    const { adminEmails, foyerAuthzEnforce } = loadConfig();
    if (estAdmin(email, adminEmails)) {
      return true; // provisioning admin : bypass de l'appartenance
    }

    const ref = extraireRefFoyer(source, req);
    if (ref === undefined) {
      // foyerId introuvable dans la requête : on ne peut pas décider sans risquer
      // de casser une route mal annotée → on laisse passer en le signalant.
      this.logger.warn(
        `appartenance : foyerId introuvable (source « ${source} ») — laissé passer`,
      );
      return true;
    }

    // Résolution (svc-foyer / svc-planification) isolée du verdict : une 403
    // **délibérée** (foyer hors ensemble) ne doit pas être avalée par ce catch
    // et requalifiée en « résolution impossible ».
    let foyerCible: string;
    let autorises: readonly string[];
    try {
      foyerCible =
        ref.kind === 'contrat'
          ? (await this.planification.contrat(ref.valeur)).foyerId
          : ref.valeur;
      autorises = await this.foyers.foyersParEmail(email);
    } catch (erreur) {
      return this.surEchecResolution(email, foyerAuthzEnforce, erreur);
    }

    if (autorises.includes(foyerCible)) {
      return true;
    }
    return this.refuser(email, foyerCible, autorises, foyerAuthzEnforce);
  }

  /** Foyer hors ensemble autorisé : 403 si enforce, sinon journalise (observe). */
  private refuser(
    email: string,
    foyerCible: string,
    autorises: readonly string[],
    enforce: boolean,
  ): boolean {
    const details =
      `${email} → foyer ${foyerCible} ` +
      `(autorisés : ${autorises.length > 0 ? autorises.join(', ') : 'aucun'})`;
    compteurRefus.add(1, {
      decision: enforce ? 'refuse' : 'aurait_refuse',
      motif: 'hors_scope',
    });
    if (enforce) {
      this.logger.warn(`appartenance REFUSÉE (403) : ${details}`);
      throw new ForbiddenException('accès à ce foyer non autorisé');
    }
    this.logger.warn(`observe-only : AURAIT REFUSÉ ${details}`);
    return true;
  }

  /** Résolution impossible : fail-closed (403) si enforce, sinon journalise. */
  private surEchecResolution(
    email: string,
    enforce: boolean,
    erreur: unknown,
  ): boolean {
    const msg = erreur instanceof Error ? erreur.message : String(erreur);
    compteurRefus.add(1, {
      decision: enforce ? 'refuse' : 'aurait_refuse',
      motif: 'resolution_impossible',
    });
    if (enforce) {
      this.logger.error(
        `appartenance : résolution impossible pour ${email}, ` +
          `refus par sécurité (fail-closed) : ${msg}`,
      );
      throw new ForbiddenException("vérification d'accès au foyer impossible");
    }
    this.logger.warn(
      `observe-only : résolution impossible pour ${email} : ${msg}`,
    );
    return true;
  }
}
