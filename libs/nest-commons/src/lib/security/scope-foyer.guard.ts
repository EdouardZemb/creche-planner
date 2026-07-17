import {
  type CanActivate,
  type ExecutionContext,
  ForbiddenException,
  Inject,
  Injectable,
  Logger,
  Optional,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { metrics } from '@opentelemetry/api';
import { type ChargeAssertion } from './assertion-identite.js';
import { type RequeteAssertable } from './assertion-identite.guard.js';
import {
  OPTIONS_ASSERTION_IDENTITE,
  type OptionsAssertionIdentite,
} from './assertion-identite.options.js';
import {
  decrireSource,
  lireValeurScope,
  SCOPE_FOYER_KEY,
  type RequeteScope,
  type SourceScopeFoyer,
} from './scope-foyer.decorator.js';
import {
  type PorteeRessource,
  RESOLVEUR_FOYER_RESSOURCE,
  type ResolveurFoyerRessource,
} from './scope-foyer.resolveur.js';

/**
 * Compteur OTel des refus de **scoping par ressource** dans un service, exporté en
 * Prometheus sous `svc_scope_refus_total{decision}` (le label `service.name` est
 * ajouté par le collector). Même modèle d'émission que `gateway_authz_refus_total`
 * (lot 2) : si aucun `MeterProvider` n'est enregistré, l'API OTel est un no-op.
 *
 * - `decision="refuse"` : mode enforce, **403** réel ;
 * - `decision="aurait_refuse"` : observe-only, laissé passer (mesure ce que l'enforce
 *   refuserait — un flux non nul AVANT bascule signale des faux positifs, cf. runbook).
 *
 * Émis **uniquement** sur une vraie violation cross-foyer (`hors-scope`), pas sur une
 * assertion absente (déjà couverte par le guard d'identité amont) : la règle d'alerte
 * `ScopeInterServicesRefus` mesure ainsi les tentatives inter-foyers, pas les appels
 * non authentifiés.
 */
const meterScope = metrics.getMeter('nest-commons.scope-foyer');
const compteurScopeRefus = meterScope.createCounter('svc_scope_refus_total', {
  description:
    'Refus de scoping par ressource dans un service (défense en profondeur, par décision réelle/observe).',
});

/** Requête vue par le guard de scoping : assertion posée en amont + emplacements de valeur. */
export type RequeteScopable = RequeteAssertable & RequeteScope;

/**
 * Motif d'un refus de scoping (log seulement) :
 * - `hors-scope` : la ressource visée n'est pas couverte par l'assertion (vraie
 *   violation cross-foyer) → seul motif comptabilisé par la métrique ;
 * - `assertion-absente` : aucune `req.assertion` (header manquant en observe ; en
 *   enforce le guard d'identité amont a déjà répondu 401) → journalisé, non comptabilisé.
 */
type MotifScope = 'hors-scope' | 'assertion-absente';

/**
 * Guard aval de **scoping par ressource** (chantier « fondations backend », lot 4 ;
 * enregistré `APP_GUARD` **après** {@link AssertionIdentiteGuard} par
 * `AssertionIdentiteModule.forRoot({ scoping })`). Il revérifie, contre les **tables
 * locales** du service, qu'une requête ne touche que des données du/des foyer(s)
 * couverts par l'assertion vérifiée (`req.assertion`) — défense en profondeur : même
 * si la gateway est contournée ou boguée, un foyer ne lit/écrit jamais chez un autre.
 *
 * Décision, sur toute route `@ScopeFoyerInterServices(...)` :
 * 1. secret absent (legacy) → passe (cohérent avec le guard d'identité) ;
 * 2. `req.assertion` absente → « SCOPE AURAIT REFUSÉ » puis, en observe, passe (en
 *    enforce ce chemin n'est pas atteint : 401 amont) ;
 * 3. assertion **machine** (appelant interne de confiance) → **bypass** ;
 * 4. assertion parent **admin** → **bypass** (aligné sur la gateway) ;
 * 5. valeur de foyer/ressource absente de la requête → laissé passer (route mal
 *    annotée, comme `AppartenanceGuard`) ;
 * 6. résolution locale → `null` (ressource inexistante) → laissé passer (le handler
 *    répond son **404**, jamais un 403 qui révélerait l'existence) ;
 * 7. portée couverte par l'assertion → passe ; sinon **violation** : en enforce
 *    **403**, en observe « SCOPE AURAIT REFUSÉ » + métrique + passe.
 *
 * Les logs portent « AURAIT REFUSÉ » (greppable conjointement avec ceux de la gateway
 * et du guard d'identité).
 */
@Injectable()
export class ScopeFoyerGuard implements CanActivate {
  private readonly logger = new Logger(ScopeFoyerGuard.name);

  constructor(
    private readonly reflector: Reflector,
    @Inject(OPTIONS_ASSERTION_IDENTITE)
    private readonly options: OptionsAssertionIdentite,
    @Optional()
    @Inject(RESOLVEUR_FOYER_RESSOURCE)
    private readonly resolveur?: ResolveurFoyerRessource,
  ) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const source = this.reflector.getAllAndOverride<
      SourceScopeFoyer | undefined
    >(SCOPE_FOYER_KEY, [ctx.getHandler(), ctx.getClass()]);
    if (source === undefined) {
      return true; // route non scopée
    }

    const { secret, enforce } = this.options.chargerConfig().assertion;
    if (secret === undefined) {
      return true; // legacy : aucun scoping (le guard d'identité est déjà en legacy)
    }

    const req = ctx.switchToHttp().getRequest<RequeteScopable>();
    const assertion = req.assertion;
    if (assertion === undefined) {
      // Header absent : en observe le guard d'identité a laissé passer sans poser
      // d'assertion ; en enforce il a déjà levé 401 (ce chemin n'est donc pas atteint).
      return this.refuser(req, enforce, source, 'assertion-absente');
    }
    // Appelant interne de confiance / admin → bypass (alignés sur la gateway).
    if (assertion.machine !== undefined || assertion.admin === true) {
      return true;
    }

    const brut = lireValeurScope(source, req);
    if (brut === undefined) {
      // Référence absente : on ne peut pas décider sans risquer de casser une route
      // mal annotée → on laisse passer en le signalant (comme `AppartenanceGuard`).
      this.logger.warn(
        `scope : référence introuvable (source « ${decrireSource(source)} ») — laissé passer`,
      );
      return true;
    }

    const portee = await this.resoudrePortee(source, brut);
    if (portee === null) {
      // Ressource inexistante → 404 laissé au handler (pas de 403 qui divulgue l'existence).
      return true;
    }
    if (this.couvert(portee, assertion)) {
      return true;
    }
    return this.refuser(req, enforce, source, 'hors-scope');
  }

  /** Portée de la ressource : valeur directe (foyer/e-mail) ou résolution locale. */
  private async resoudrePortee(
    source: SourceScopeFoyer,
    brut: string,
  ): Promise<PorteeRessource | null> {
    if (source.resoudre === undefined) {
      return source.comparer === 'email'
        ? { type: 'proprietaire', email: brut }
        : { type: 'foyer', foyerId: brut };
    }
    if (this.resolveur === undefined) {
      throw new Error(
        `ScopeFoyerGuard : @ScopeFoyerInterServices({ resoudre: '${source.resoudre}' }) ` +
          'exige un ResolveurFoyerRessource, aucun fourni à AssertionIdentiteModule.forRoot({ scoping })',
      );
    }
    return this.resolveur.resoudre(source.resoudre, brut);
  }

  /** Vrai si l'assertion couvre la portée (foyer ∈ foyers, ou e-mail == e-mail). */
  private couvert(
    portee: PorteeRessource,
    assertion: ChargeAssertion,
  ): boolean {
    if (portee.type === 'foyer') {
      return (assertion.foyers ?? []).includes(portee.foyerId);
    }
    // Comparaison d'e-mails insensible à la casse (convention `lower(email)` du repo).
    const attendu = assertion.email?.toLowerCase();
    return attendu !== undefined && portee.email.toLowerCase() === attendu;
  }

  /** Refuse (403) en enforce, journalise « SCOPE AURAIT REFUSÉ » et passe en observe. */
  private refuser(
    req: RequeteScopable,
    enforce: boolean,
    source: SourceScopeFoyer,
    motif: MotifScope,
  ): boolean {
    // Seule une vraie violation cross-foyer alimente la métrique/alerte (pas une
    // assertion absente, déjà signalée par le guard d'identité).
    if (motif === 'hors-scope') {
      compteurScopeRefus.add(1, {
        decision: enforce ? 'refuse' : 'aurait_refuse',
      });
    }
    const chemin = req.originalUrl ?? req.url ?? '?';
    const details =
      `${req.method ?? '?'} ${chemin} ` +
      `(source « ${decrireSource(source)} », motif : ${motif})`;
    if (enforce) {
      this.logger.warn(`SCOPE REFUSÉ (403) : ${details}`);
      throw new ForbiddenException(
        'accès à cette ressource non autorisé pour ce foyer',
      );
    }
    this.logger.warn(`observe-only : SCOPE AURAIT REFUSÉ ${details}`);
    return true;
  }
}
