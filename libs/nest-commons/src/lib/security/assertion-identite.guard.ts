import {
  type CanActivate,
  type ExecutionContext,
  Inject,
  Injectable,
  Logger,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import {
  type ChargeAssertion,
  ENTETE_ASSERTION,
  verifierAssertion,
} from './assertion-identite.js';
import {
  OPTIONS_ASSERTION_IDENTITE,
  type OptionsAssertionIdentite,
} from './assertion-identite.options.js';
import { ASSERTION_PUBLIQUE_KEY } from './assertion-publique.decorator.js';

/**
 * Requête vue par le guard : en-têtes + méthode/chemin (pour le log), et le champ
 * `assertion` posé sur la requête quand la vérification réussit (lu au lot 4 pour
 * le scoping par ressource).
 */
export interface RequeteAssertable {
  readonly headers: Record<string, string | string[] | undefined>;
  readonly method?: string;
  readonly url?: string;
  readonly originalUrl?: string;
  assertion?: ChargeAssertion;
}

/**
 * Motif de refus (mode observe/enforce). Séparé du succès pour une union
 * exhaustive — `en-tete-absent` (aucun `x-assertion-identite`) vs
 * `assertion-invalide` (signature/format/expiration KO, motifs non distingués
 * pour ne rien divulguer).
 */
export type MotifRefus = 'en-tete-absent' | 'assertion-invalide';

/**
 * Verdict interne du guard (union discriminée exhaustive) :
 * - `legacy` : secret non configuré → on ne vérifie rien (env non migré) ;
 * - `valide` : assertion vérifiée, charge posée sur la requête ;
 * - `refuse` : à refuser en enforce, à journaliser en observe.
 */
export type ResultatVerification =
  | { readonly statut: 'legacy' }
  | { readonly statut: 'valide'; readonly charge: ChargeAssertion }
  | { readonly statut: 'refuse'; readonly motif: MotifRefus };

/** Première valeur d'un en-tête HTTP (Express peut renvoyer un tableau). */
function entete(
  headers: Record<string, string | string[] | undefined>,
  nom: string,
): string | undefined {
  const brut = headers[nom];
  return Array.isArray(brut) ? brut[0] : brut;
}

/**
 * Guard aval d'**assertion d'identité inter-services** (lib, enregistré `APP_GUARD`
 * dans les 5 services via {@link AssertionIdentiteModule}). Trois modes selon la
 * config du service :
 *
 * 1. **legacy** — `ASSERTION_IDENTITE_SECRET` absent : ne vérifie rien, passe (log
 *    debug **unique** au premier appel). Mode des environnements non migrés.
 * 2. **observe** — secret présent, `INTERSERVICE_AUTHZ_ENFORCE` ≠ 1 : vérifie ; en
 *    cas d'absence/invalidité/expiration, journalise « ASSERTION AURAIT REFUSÉ »
 *    (greppable avec le « AURAIT REFUSÉ » de la gateway) **et passe**. Si valide,
 *    pose `req.assertion` (payload vérifié, pour le lot 4).
 * 3. **enforce** — `INTERSERVICE_AUTHZ_ENFORCE=1` : **401** si en-tête
 *    absent/invalide/expiré. Logique câblée et testée dès ce lot, mais **aucun
 *    environnement ne l'active** dans ce chantier (observe partout).
 *
 * Les routes marquées {@link AssertionPubliqueInterServices} (health, désabonnement
 * one-click) sont exemptées quel que soit le mode.
 */
@Injectable()
export class AssertionIdentiteGuard implements CanActivate {
  private readonly logger = new Logger(AssertionIdentiteGuard.name);
  private legacyJournalise = false;

  constructor(
    private readonly reflector: Reflector,
    @Inject(OPTIONS_ASSERTION_IDENTITE)
    private readonly options: OptionsAssertionIdentite,
  ) {}

  canActivate(ctx: ExecutionContext): boolean {
    const estPublique = this.reflector.getAllAndOverride<boolean>(
      ASSERTION_PUBLIQUE_KEY,
      [ctx.getHandler(), ctx.getClass()],
    );
    if (estPublique) {
      return true;
    }

    const req = ctx.switchToHttp().getRequest<RequeteAssertable>();
    const { secret, enforce } = this.options.chargerConfig().assertion;
    const resultat = this.verifier(req, secret);

    switch (resultat.statut) {
      case 'legacy':
        this.journaliserLegacy();
        return true;
      case 'valide':
        req.assertion = resultat.charge;
        return true;
      case 'refuse':
        return this.gererRefus(req, enforce, resultat.motif);
    }
  }

  /** Applique les 3 modes selon la présence du secret et la vérification. */
  private verifier(
    req: RequeteAssertable,
    secret: string | undefined,
  ): ResultatVerification {
    if (secret === undefined) {
      return { statut: 'legacy' };
    }
    const brut = entete(req.headers, ENTETE_ASSERTION);
    if (brut === undefined) {
      return { statut: 'refuse', motif: 'en-tete-absent' };
    }
    const charge = verifierAssertion(brut, secret, new Date());
    if (charge === null) {
      return { statut: 'refuse', motif: 'assertion-invalide' };
    }
    return { statut: 'valide', charge };
  }

  /** Log debug unique au boot quand aucun secret n'est configuré (legacy). */
  private journaliserLegacy(): void {
    if (!this.legacyJournalise) {
      this.legacyJournalise = true;
      this.logger.debug(
        'assertion inter-services non configurée (ASSERTION_IDENTITE_SECRET absent) — mode legacy, aucune vérification',
      );
    }
  }

  /** Refuse (401) en enforce, journalise « AURAIT REFUSÉ » et passe en observe. */
  private gererRefus(
    req: RequeteAssertable,
    enforce: boolean,
    motif: MotifRefus,
  ): boolean {
    const chemin = req.originalUrl ?? req.url ?? '?';
    const details = `${req.method ?? '?'} ${chemin} (motif : ${motif})`;
    if (enforce) {
      this.logger.warn(`ASSERTION REFUSÉE (401) : ${details}`);
      throw new UnauthorizedException(
        "assertion d'identité inter-services requise",
      );
    }
    this.logger.warn(`observe-only : ASSERTION AURAIT REFUSÉ ${details}`);
    return true;
  }
}
