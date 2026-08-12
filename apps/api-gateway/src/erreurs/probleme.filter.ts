import {
  type ArgumentsHost,
  Catch,
  type ExceptionFilter,
  type ExecutionContext,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import {
  CODES_PROBLEME,
  estCodeProbleme,
  MEDIA_TYPE_PROBLEME,
  typeProbleme,
  type CodeProbleme,
  type ErreurChamp,
  type Probleme,
} from '@creche-planner/contracts-kernel';
import { FORMAT_ERREUR_NATIF_KEY } from './format-erreur-natif.decorator.js';

/** Sous-ensemble de la réponse Express utilisé ici (évite @types/express). */
interface ReponseHttp {
  setHeader(nom: string, valeur: string): void;
  status(code: number): { json(corps: unknown): void };
}

/** Sous-ensemble de la requête Express utilisé ici. */
interface RequeteHttp {
  readonly originalUrl?: string;
  readonly url?: string;
}

/**
 * Titre par défaut d'un problème sans code métier. RFC 9457 §3.1.1 : quand
 * `type` vaut `about:blank`, `title` **est** la phrase du statut HTTP. Elle est
 * rendue en français comme le reste de l'API, qui n'a qu'une locale.
 */
const PHRASES_STATUT: Readonly<Record<number, string>> = {
  400: 'Requête invalide',
  401: 'Authentification requise',
  403: 'Accès refusé',
  404: 'Ressource introuvable',
  409: 'Conflit',
  422: 'Entité non traitable',
  429: 'Trop de requêtes',
  500: 'Erreur interne',
  502: 'Service amont indisponible',
  503: 'Service indisponible',
  504: 'Délai dépassé en amont',
};

/**
 * Seuil des erreurs serveur. Littéral plutôt que `HttpStatus.INTERNAL_SERVER_ERROR` :
 * le statut comparé vient d'une `HttpException` et n'est qu'un `number` — comparer
 * un nombre à un membre d'énumération est refusé par `no-unsafe-enum-comparison`.
 */
const SEUIL_ERREUR_SERVEUR = 500;

/** Message rendu au client quand l'erreur n'a **pas** été formulée pour lui. */
const DETAIL_GENERIQUE = 'le service a rencontré une erreur inattendue';

/** Lit un tableau `[{ champ, message }]` — la forme des erreurs de validation. */
function erreursChamps(valeur: unknown): readonly ErreurChamp[] | undefined {
  if (!Array.isArray(valeur)) return undefined;
  const champs = valeur.filter(
    (e): e is ErreurChamp =>
      typeof e === 'object' &&
      e !== null &&
      typeof (e as Record<string, unknown>)['champ'] === 'string' &&
      typeof (e as Record<string, unknown>)['message'] === 'string',
  );
  return champs.length > 0 ? champs : undefined;
}

/** Vrai pour un objet indexable (et non un tableau). */
function estObjet(valeur: unknown): valeur is Record<string, unknown> {
  return (
    typeof valeur === 'object' && valeur !== null && !Array.isArray(valeur)
  );
}

/** Première chaîne non vide parmi les valeurs proposées. */
function premiereChaine(...valeurs: unknown[]): string | undefined {
  for (const valeur of valeurs) {
    if (typeof valeur === 'string' && valeur.length > 0) return valeur;
  }
  return undefined;
}

/**
 * **Filtre global d'erreurs de la passerelle — RFC 9457** (`AM-37`, lot 4).
 *
 * Il n'invente aucun contenu : il **traduit** ce que les couches en amont ont
 * déjà dit, dans la seule forme que le contrat publie
 * (`application/problem+json`). Trois sources coexistaient sur le fil et sont
 * ici ramenées à une :
 *
 * - le corps par défaut de Nest (`{ statusCode, message, error }`), y compris
 *   le cas où `message` **est** le tableau `[{ champ, message }]` de `valider()` ;
 * - le 409 structuré relayé de `svc-foyer`/`svc-referentiel`
 *   (`{ statusCode, code, message }`) — son `code` métier survit **tel quel**
 *   dans le membre d'extension `code`, c'est la condition pour que la traversée
 *   ne casse ni les pacts ni les écrans qui le lisent ;
 * - le repli du relais BFF (`{ statut, message, detail }`) sur panne amont.
 *
 * **Ce qui ne sort pas.** Une exception qui n'est pas une `HttpException` n'a
 * pas été formulée pour un client : son message peut porter du SQL, un chemin
 * ou un identifiant interne. Elle devient un 500 au `detail` générique, et
 * c'est le **journal** qui garde la cause — comme le faisait le gestionnaire par
 * défaut de Nest, que ce filtre remplace.
 */
@Catch()
export class ProblemeFilter implements ExceptionFilter {
  private readonly logger = new Logger(ProblemeFilter.name);

  constructor(private readonly reflector: Reflector) {}

  catch(exception: unknown, host: ArgumentsHost): void {
    if (host.getType() !== 'http') throw exception;

    const contexte = host.switchToHttp();
    const reponse = contexte.getResponse<ReponseHttp>();
    const statut = statutDe(exception);

    if (statut >= SEUIL_ERREUR_SERVEUR) {
      // Le gestionnaire par défaut de Nest journalisait les 5xx ; le remplacer
      // sans reprendre ce geste aurait rendu les pannes muettes.
      this.logger.error(
        exception instanceof Error ? exception.message : String(exception),
        exception instanceof Error ? exception.stack : undefined,
      );
    }

    if (this.formatNatif(host)) {
      reponse.status(statut).json(corpsNatif(exception, statut));
      return;
    }

    const requete = contexte.getRequest<RequeteHttp>();
    const probleme = versProbleme(
      exception,
      statut,
      requete.originalUrl ?? requete.url,
    );
    // Posé AVANT `json()` : Express ne fixe `application/json` que si aucun
    // type de contenu n'est déjà défini.
    reponse.setHeader('Content-Type', MEDIA_TYPE_PROBLEME);
    reponse.status(statut).json(probleme);
  }

  /** Vrai si la route porte `@FormatErreurNatif()` (contrôleur ou méthode). */
  private formatNatif(host: ArgumentsHost): boolean {
    // `catch` reçoit un `ArgumentsHost`, mais Nest lui passe en réalité un
    // `ExecutionContextHost` : la classe et le handler de la route y sont posés
    // par le proxy de routage. Hors d'une route résolue (404 du routeur, erreur
    // de middleware) ils valent `undefined`, et `getAllAndOverride` refuse un
    // tableau vide.
    const contexte = host as ExecutionContext;
    const cibles = [contexte.getHandler(), contexte.getClass()].filter(
      (cible): cible is NonNullable<typeof cible> => Boolean(cible),
    );
    if (cibles.length === 0) return false;
    // `boolean | undefined` et non `boolean` : le paramètre de type de
    // `getAllAndOverride` est déclaratif, il ne dit rien de l'absence de
    // métadonnée — qui est justement le cas courant.
    return (
      this.reflector.getAllAndOverride<boolean | undefined>(
        FORMAT_ERREUR_NATIF_KEY,
        cibles,
      ) ?? false
    );
  }
}

/** Statut HTTP porté par l'exception, 500 pour tout ce qui n'en porte pas. */
function statutDe(exception: unknown): number {
  return exception instanceof HttpException
    ? exception.getStatus()
    : HttpStatus.INTERNAL_SERVER_ERROR;
}

/** Corps que le gestionnaire par défaut de Nest aurait produit (routes exemptées). */
function corpsNatif(exception: unknown, statut: number): unknown {
  if (!(exception instanceof HttpException)) {
    return { statusCode: statut, message: 'Internal server error' };
  }
  const corps = exception.getResponse();
  return estObjet(corps) ? corps : { statusCode: statut, message: corps };
}

/** Traduit une exception en `Probleme`, sans jamais divulguer d'interne. */
function versProbleme(
  exception: unknown,
  status: number,
  instance: string | undefined,
): Probleme {
  const corps =
    exception instanceof HttpException ? exception.getResponse() : undefined;
  const objet = estObjet(corps) ? corps : undefined;

  const code: CodeProbleme | undefined =
    objet !== undefined && estCodeProbleme(objet['code'])
      ? objet['code']
      : undefined;

  const erreurs =
    objet !== undefined
      ? (erreursChamps(objet['erreurs']) ?? erreursChamps(objet['message']))
      : undefined;

  const detail =
    exception instanceof HttpException
      ? // `message` AVANT `detail` : quand le relais BFF échoue à joindre un
        // amont, il porte les deux — `message` est la phrase écrite pour le
        // client (« erreur du service amont »), `detail` la cause brute
        // (« HTTP 503 »), qui n'a rien à faire dans une réponse publique.
        premiereChaine(
          typeof corps === 'string' ? corps : undefined,
          objet?.['message'],
          objet?.['detail'],
        )
      : DETAIL_GENERIQUE;

  return {
    type: code === undefined ? 'about:blank' : typeProbleme(code),
    title:
      code === undefined
        ? (PHRASES_STATUT[status] ?? `Erreur ${String(status)}`)
        : CODES_PROBLEME[code],
    status,
    ...(detail === undefined ? {} : { detail }),
    ...(instance === undefined ? {} : { instance }),
    ...(code === undefined ? {} : { code }),
    ...(erreurs === undefined ? {} : { erreurs: [...erreurs] }),
  };
}
