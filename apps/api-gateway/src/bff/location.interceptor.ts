import {
  type CallHandler,
  type ExecutionContext,
  Injectable,
  Logger,
  type NestInterceptor,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { map, type Observable } from 'rxjs';
import {
  RESSOURCE_CREEE_KEY,
  type IdentifiantCree,
} from './ressource-creee.decorator.js';

/** Sous-ensemble de la réponse Express utilisé ici (évite @types/express). */
interface ReponseHttp {
  readonly headersSent: boolean;
  setHeader(nom: string, valeur: string): void;
}

/** Sous-ensemble de la requête Express utilisé ici. */
interface RequeteHttp {
  readonly originalUrl?: string;
  readonly url?: string;
}

/**
 * Chemin de la requête **sans** la chaîne de requête, et sans `/` final. Même
 * règle que l'`instance` d'un problème RFC 9457 (`probleme.filter.ts`), et pour
 * la même raison : une query peut porter un jeton actionnable sans
 * authentification (`?token=…`). Un `Location` est un en-tête que le navigateur
 * expose, que les journaux d'accès gardent et que les intermédiaires relaient —
 * il n'y a aucune raison qu'il en transporte davantage que le chemin.
 */
function baseRessource(requete: RequeteHttp): string | undefined {
  const url = requete.originalUrl ?? requete.url;
  if (typeof url !== 'string' || url.length === 0) return undefined;
  const separateur = url.indexOf('?');
  const chemin = separateur === -1 ? url : url.slice(0, separateur);
  const sansSlashFinal = chemin.replace(/\/+$/, '');
  return sansSlashFinal.length > 0 ? sansSlashFinal : undefined;
}

/**
 * **`Location` sur les créations de la passerelle** (RFC 9110 §10.2.2, `AM-39`,
 * lot 7). Une route marquée `@RessourceCreee(vue => id)` voit son 201 porter
 * l'URI de la ressource créée.
 *
 * **Le chemin est dérivé, pas déclaré.** Il vaut l'URL de la requête (une
 * collection : `POST /api/v1/foyers/{id}/enfants`) suivie de l'identifiant rendu
 * par le handler. Un gabarit écrit dans le décorateur aurait été une quatrième
 * copie du chemin de la route, libre de se désaligner de `@Controller`/`@Post`
 * sans que rien ne le dise ; l'URL de la requête, elle, **est** la route servie.
 *
 * **La référence est relative**, comme l'autorise la RFC (§10.2.2 renvoie à
 * `URI-reference`). La passerelle est servie derrière un tunnel Cloudflare : elle
 * ne connaît pas son origine publique, et la reconstruire depuis `Host` ou
 * `X-Forwarded-*` serait fabriquer une URL absolue à partir d'en-têtes que le
 * client contrôle. Le client résout la référence contre l'URL qu'il a appelée,
 * ce qui est exactement la bonne origine, sans avoir à la deviner ici.
 *
 * **Aucune requête n'échoue à cause de cet en-tête**, et cette garantie doit être
 * tenue par le code, pas seulement promise. Un identifiant absent, vide ou non
 * textuel fait renoncer au `Location` ; et l'extraction elle-même est protégée,
 * parce qu'elle **déréférence** (`vue.foyer.id`) : le schéma zod du client rend
 * la forme sûre aujourd'hui, mais rien dans le typage du décorateur ne l'impose,
 * et l'enjeu est asymétrique — nous sommes **après** l'écriture. Une exception
 * ici transformerait une création réussie en 500, sur lequel le client
 * relancerait une création déjà faite. Un en-tête décoratif ne vaut pas ce
 * risque : on le laisse tomber, en le journalisant.
 */
@Injectable()
export class LocationInterceptor implements NestInterceptor {
  private readonly logger = new Logger(LocationInterceptor.name);

  constructor(private readonly reflector: Reflector) {}

  intercept(
    contexte: ExecutionContext,
    suivant: CallHandler,
  ): Observable<unknown> {
    if (contexte.getType() !== 'http') return suivant.handle();

    // Métadonnée de **méthode** uniquement : « cette route crée telle ressource »
    // n'a pas de sens à l'échelle d'un contrôleur, et l'hériter en poserait un
    // sur les routes voisines qui ne créent rien.
    const identifiant = this.reflector.get<
      IdentifiantCree<unknown> | undefined
    >(RESSOURCE_CREEE_KEY, contexte.getHandler());
    if (typeof identifiant !== 'function') return suivant.handle();

    const http = contexte.switchToHttp();
    const base = baseRessource(http.getRequest<RequeteHttp>());
    if (base === undefined) return suivant.handle();

    return suivant.handle().pipe(
      map((vue: unknown) => {
        const reponse = http.getResponse<ReponseHttp>();
        let id: string | undefined;
        try {
          id = identifiant(vue);
        } catch (erreur) {
          // La création a réussi : on rend la réponse, amputée de son en-tête.
          this.logger.warn(
            `Location non posé sur ${base} : ${
              erreur instanceof Error ? erreur.message : String(erreur)
            }`,
          );
          return vue;
        }
        if (typeof id === 'string' && id.length > 0 && !reponse.headersSent) {
          reponse.setHeader('Location', `${base}/${encodeURIComponent(id)}`);
        }
        return vue;
      }),
    );
  }
}
