import {
  HTTP_CODE_METADATA,
  METHOD_METADATA,
  MODULE_METADATA,
  PATH_METADATA,
  VERSION_METADATA,
} from '@nestjs/common/constants';
import {
  Controller,
  Delete,
  Get,
  HttpCode,
  Post,
  RequestMethod,
} from '@nestjs/common';
import { describe, expect, it } from 'vitest';
import { gatewayOpenApiDocument } from '@creche-planner/contracts-kernel';
import { AppModule } from '../app.module.js';
import { FORMAT_ERREUR_NATIF_KEY } from '../erreurs/format-erreur-natif.decorator.js';
import {
  RESSOURCE_CREEE_KEY,
  RessourceCreee,
} from '../bff/ressource-creee.decorator.js';

/**
 * **Garde de couverture OpenAPI (lot D6).**
 *
 * `gateway.openapi.spec.ts` (contracts-kernel) vérifie que le document expose
 * *exactement N routes* — mais la liste attendue y est écrite à la main, en face
 * d'un document lui aussi écrit à la main : les deux côtés sont la même main,
 * l'oracle ne dit donc **rien du service réellement rendu**. Une route ajoutée à
 * un contrôleur et absente du document passait les deux gardes.
 *
 * Cette garde-ci ferme l'écart en confrontant le document au **graphe de modules
 * Nest réel** : elle recompose les routes servies (préfixe global `api`,
 * versionnage URI, chemins de contrôleur et de méthode) et exige l'égalité, dans
 * les DEUX sens :
 *
 * - une opération servie et non documentée ⇒ le web la consomme sans type généré
 *   (`openapi-types.gen.ts` ne peut décrire que ce que le document contient) ;
 * - une opération documentée et non servie ⇒ le document promet un 404.
 *
 * On lit ici la **métadonnée** des décorateurs, jamais l'injection : `Nest` pose
 * `path`/`method`/`__version__` au moment de la décoration, indépendamment de
 * `emitDecoratorMetadata`. C'est ce qui permet de le faire in-process sous vitest,
 * alors que *booter* l'application y casse la DI (esbuild n'émet pas
 * `design:paramtypes` — cf. l'en-tête de `e2e/parcours.e2e.spec.ts`).
 *
 * ⚠️ **Les deux côtés ne sont pas lus à la même fraîcheur.** Le code vient des
 * sources (vitest les transforme), le contrat vient du **paquet construit**
 * (`@creche-planner/contracts-kernel` résout vers `dist/`). Un `npx vitest` lancé
 * seul juge donc le contrat de la **dernière construction**, pas celui du disque :
 * une modification de `gateway.openapi.ts` y reste invisible — et une sonde
 * négative jouée ainsi rend un faux « la porte ne mord pas ». Les commandes du
 * dépôt (`nx run api-gateway:test`, `nx affected`) construisent `contracts-kernel`
 * avant, l'écart n'existe donc pas en CI ; il n'existe qu'au doigt mouillé local.
 * Même famille qu'`EM-11` : une porte dont le verdict dépend d'un artefact.
 */

/** Préfixe global posé par `configurerApp` (`app.setGlobalPrefix('api')`). */
const PREFIXE_GLOBAL = 'api';

/** Une opération HTTP servie : `GET /api/v1/foyers/{id}`. */
type Operation = string;

/**
 * Une route servie, avec ce que Nest en rendra vraiment. `statut` n'est **pas**
 * lu dans le document : il est **dérivé** de la métadonnée `@HttpCode` et, à
 * défaut, du défaut de Nest par verbe — c'est là tout l'intérêt de la garde, le
 * défaut étant invisible dans le code.
 */
interface RouteServie {
  readonly operation: Operation;
  readonly statut: number;
  /** La route pose-t-elle un `Location` (décorateur `@RessourceCreee`) ? */
  readonly ressourceCreee: boolean;
}

/** Classe de contrôleur telle que Nest la voit (constructeur + prototype). */
type ClasseControleur = new (...args: never[]) => object;

/** Entrée d'un `imports` de module : classe, module dynamique, `null`… */
type EntreeImport =
  | ClasseControleur
  | { module?: unknown; imports?: unknown; controllers?: unknown }
  | null
  | undefined;

/**
 * Garde de type sur un tableau de valeurs non typées : `Array.isArray` seul
 * narrowerait en `any[]`, ce qui rendrait muettes les règles `no-unsafe-*` sur
 * tout ce qu'on en tire.
 */
function estTableau(valeur: unknown): valeur is readonly unknown[] {
  return Array.isArray(valeur);
}

const VERBES = new Map<number, string>([
  [RequestMethod.GET, 'get'],
  [RequestMethod.POST, 'post'],
  [RequestMethod.PUT, 'put'],
  [RequestMethod.PATCH, 'patch'],
  [RequestMethod.DELETE, 'delete'],
  [RequestMethod.OPTIONS, 'options'],
  [RequestMethod.HEAD, 'head'],
]);

/** Découpe un chemin Nest en segments non vides, `:param` → `{param}`. */
function segments(chemin: unknown): string[] {
  if (typeof chemin !== 'string') return [];
  return chemin
    .split('/')
    .filter((s) => s.length > 0 && s !== '/')
    .map((s) => (s.startsWith(':') ? `{${s.slice(1)}}` : s));
}

/**
 * Recompose l'URL servie : `/api` + `/v{version}` (sauf version neutre) +
 * chemin du contrôleur + chemin de la méthode.
 */
function urlServie(
  versionControleur: unknown,
  versionMethode: unknown,
  cheminControleur: unknown,
  cheminMethode: unknown,
): string {
  const version = versionMethode ?? versionControleur;
  const prefixeVersion = typeof version === 'string' ? [`v${version}`] : [];
  return `/${[
    PREFIXE_GLOBAL,
    ...prefixeVersion,
    ...segments(cheminControleur),
    ...segments(cheminMethode),
  ].join('/')}`;
}

/**
 * Statut de succès que Nest rendra **réellement** : celui de `@HttpCode` s'il y
 * en a un, sinon le défaut du framework — **201 sur `POST`**, 200 partout
 * ailleurs. Ce défaut est le cœur du sujet : il ne s'écrit nulle part dans le
 * code, donc rien ne le confronte au contrat, et deux `POST` qui ne créent rien
 * répondaient 201 en promettant 200 (lot 7).
 */
function statutServi(handler: unknown, verbe: string): number {
  const code: unknown =
    typeof handler === 'function'
      ? Reflect.getMetadata(HTTP_CODE_METADATA, handler)
      : undefined;
  if (typeof code === 'number') return code;
  // Le verbe **résolu** (`VERBES`) plutôt que la valeur brute de
  // `METHOD_METADATA` : celle-ci est un `number` que TypeScript ne rattache pas
  // à `RequestMethod`, et la comparer à l'énumération se ferait hors de tout
  // typage — la garde reposerait alors sur un `number` nu.
  return verbe === 'post' ? 201 : 200;
}

/**
 * Routes servies par un contrôleur, d'après ses métadonnées de décorateurs.
 * `retenirRoute` filtre **par route** (classe + handler), ce dont a besoin toute
 * garde portant sur un décorateur posable aux deux niveaux.
 */
function routesDuControleur(
  controleur: ClasseControleur,
  retenirRoute: (classe: ClasseControleur, handler: unknown) => boolean = () =>
    true,
): RouteServie[] {
  const cheminControleur: unknown = Reflect.getMetadata(
    PATH_METADATA,
    controleur,
  );
  const versionControleur: unknown = Reflect.getMetadata(
    VERSION_METADATA,
    controleur,
  );
  const { prototype } = controleur as { prototype: Record<string, unknown> };

  return Object.getOwnPropertyNames(prototype)
    .filter((nom) => nom !== 'constructor')
    .flatMap((nom) => {
      const handler: unknown = prototype[nom];
      if (typeof handler !== 'function') return [];
      const methode: unknown = Reflect.getMetadata(METHOD_METADATA, handler);
      if (typeof methode !== 'number') return [];
      const verbe = VERBES.get(methode);
      if (verbe === undefined) return [];
      if (!retenirRoute(controleur, handler)) return [];
      const url = urlServie(
        versionControleur,
        Reflect.getMetadata(VERSION_METADATA, handler),
        cheminControleur,
        Reflect.getMetadata(PATH_METADATA, handler),
      );
      return [
        {
          operation: `${verbe.toUpperCase()} ${url}`,
          statut: statutServi(handler, verbe),
          ressourceCreee:
            Reflect.getMetadata(RESSOURCE_CREEE_KEY, handler) !== undefined,
        },
      ];
    });
}

/** Vue « nom d'opération seul » des routes servies (les gardes historiques). */
function operationsDuControleur(
  controleur: ClasseControleur,
  retenirRoute?: (classe: ClasseControleur, handler: unknown) => boolean,
): Operation[] {
  return routesDuControleur(controleur, retenirRoute).map((r) => r.operation);
}

/**
 * Parcourt le graphe de modules depuis `racine` et rend toutes les opérations
 * servies. Traverse aussi les **modules dynamiques** (`X.forRoot()`), qui sont des
 * objets `{ module, imports, controllers }` et non des classes : les ignorer
 * rendrait la garde aveugle au jour où un module tiers exposerait une route.
 */
function routesServies(
  racine: ClasseControleur,
  retenirRoute: (classe: ClasseControleur, handler: unknown) => boolean = () =>
    true,
): RouteServie[] {
  const vus = new Set<unknown>();
  const trouvees = new Map<Operation, RouteServie>();
  const aVisiter: EntreeImport[] = [racine];

  while (aVisiter.length > 0) {
    const entree = aVisiter.pop();
    if (entree === undefined || entree === null) continue;
    // Un `imports` peut porter une promesse (module asynchrone) : hors périmètre,
    // et signalé comme tel plutôt que traversé silencieusement à moitié.
    if (typeof entree !== 'function' && typeof entree !== 'object') continue;
    if (vus.has(entree)) continue;
    vus.add(entree);

    const cible: unknown =
      typeof entree === 'object' && 'module' in entree ? entree.module : entree;

    // Les métadonnées d'un module dynamique vivent sur l'objet retourné ; celles
    // d'un module statique, sur la classe.
    const lire = (cle: string): unknown =>
      (typeof entree === 'object' && cle in entree
        ? (entree as Record<string, unknown>)[cle]
        : undefined) ??
      (typeof cible === 'function'
        ? Reflect.getMetadata(cle, cible)
        : undefined);

    const controleurs = lire(MODULE_METADATA.CONTROLLERS);
    if (estTableau(controleurs)) {
      for (const controleur of controleurs) {
        for (const route of routesDuControleur(
          controleur as ClasseControleur,
          retenirRoute,
        )) {
          trouvees.set(route.operation, route);
        }
      }
    }

    const imports = lire(MODULE_METADATA.IMPORTS);
    if (estTableau(imports)) {
      aVisiter.push(...(imports as EntreeImport[]));
    }
  }

  return [...trouvees.values()];
}

/** Vue « nom d'opération seul » du graphe servi (les gardes historiques). */
function operationsServies(
  racine: ClasseControleur,
  retenirRoute?: (classe: ClasseControleur, handler: unknown) => boolean,
): Set<Operation> {
  return new Set(routesServies(racine, retenirRoute).map((r) => r.operation));
}

/** Opérations décrites par le document OpenAPI. */
function operationsDocumentees(): Set<Operation> {
  const documentees = new Set<Operation>();
  for (const [chemin, item] of Object.entries(gatewayOpenApiDocument.paths)) {
    for (const verbe of Object.keys(item)) {
      if (VERBES.has(RequestMethod[verbe.toUpperCase() as 'GET'])) {
        documentees.add(`${verbe.toUpperCase()} ${chemin}`);
      }
    }
  }
  return documentees;
}

const servies = operationsServies(AppModule);
const documentees = operationsDocumentees();

const trier = (ensemble: Iterable<Operation>): Operation[] =>
  [...ensemble].sort((a, b) => a.localeCompare(b));

describe('OpenAPI · couverture des routes réellement servies (D6)', () => {
  // Garde anti-balayage-à-vide : un parcours qui ne trouve rien rendrait
  // « 0 écart », indiscernable d'un succès (piège appris en C1).
  it('voit bien le graphe de modules (sinon la comparaison ne prouve rien)', () => {
    expect(servies.size).toBeGreaterThanOrEqual(40);
    expect(servies).toContain('GET /api/health');
    expect(servies).toContain('GET /api/openapi.json');
    expect(servies).toContain('POST /api/v1/foyers');
    expect(servies).toContain('GET /api/v1/moi/profil');
  });

  it('documente toute opération servie', () => {
    const nonDocumentees = trier(servies).filter((o) => !documentees.has(o));
    expect(nonDocumentees).toEqual([]);
  });

  it('ne documente aucune opération qui ne serait pas servie', () => {
    const fantomes = trier(documentees).filter((o) => !servies.has(o));
    expect(fantomes).toEqual([]);
  });
});

/**
 * Vrai si **cette route** est exemptée du format `application/problem+json` —
 * par sa classe ou par son handler. `ProblemeFilter` lit les deux
 * (`getAllAndOverride([handler, classe])`) : ne regarder que la classe
 * laisserait une exemption posée sur une seule méthode diverger du contrat en
 * silence, soit exactement l'écart que cette garde existe pour voir.
 */
function estExemptee(classe: ClasseControleur, handler: unknown): boolean {
  return (
    Reflect.getMetadata(FORMAT_ERREUR_NATIF_KEY, classe) === true ||
    (typeof handler === 'function' &&
      Reflect.getMetadata(FORMAT_ERREUR_NATIF_KEY, handler) === true)
  );
}

/**
 * Opérations dont le corps d'erreur documenté **n'est pas** le problème commun :
 * au moins une réponse 4xx/5xx y déclare un contenu qui n'est pas
 * `application/problem+json`. C'est le pendant contractuel de
 * `@FormatErreurNatif()`, et rien n'oblige les deux à rester d'accord — sinon
 * cette garde.
 */
function operationsAuCorpsDErreurPropre(): Set<Operation> {
  return operationsParTypeDErreur().propres;
}

/**
 * Classe les opérations documentées selon le corps de leurs réponses d'erreur.
 * Une opération **sans aucune** réponse 4xx/5xx documentée n'entre dans aucun
 * des deux ensembles : c'est le cas de `GET /api/health/live`, exemptée côté
 * code et pourtant absente du contrat côté erreurs — la comparer aveuglément
 * ferait échouer la garde sur une opération dont il n'y a rien à dire.
 */
function operationsParTypeDErreur(): {
  propres: Set<Operation>;
  problemes: Set<Operation>;
} {
  const propres = new Set<Operation>();
  const problemes = new Set<Operation>();
  for (const [chemin, item] of Object.entries(gatewayOpenApiDocument.paths)) {
    for (const [verbe, operation] of Object.entries(item)) {
      if (!VERBES.has(RequestMethod[verbe.toUpperCase() as 'GET'])) continue;
      const reponses = (operation as { responses?: Record<string, unknown> })
        .responses;
      for (const [statut, reponse] of Object.entries(reponses ?? {})) {
        if (!/^[45]\d\d$/.test(statut)) continue;
        const contenu = (reponse as { content?: Record<string, unknown> })
          .content;
        const types = Object.keys(contenu ?? {});
        if (types.length === 0) continue;
        const operationId = `${verbe.toUpperCase()} ${chemin}`;
        if (types.includes('application/problem+json')) {
          problemes.add(operationId);
        } else {
          propres.add(operationId);
        }
      }
    }
  }
  return { propres, problemes };
}

describe('OpenAPI · format d’erreur unique (RFC 9457, AM-37)', () => {
  const exemptees = operationsServies(AppModule, estExemptee);
  const corpsPropre = operationsAuCorpsDErreurPropre();
  const corpsProbleme = operationsParTypeDErreur().problemes;

  // Anti-balayage-à-vide : sans exemption trouvée des DEUX côtés, les égalités
  // ci-dessous seraient `∅ === ∅` — vraies et vides de sens.
  it('voit l’exemption des deux côtés (métadonnée Nest et document)', () => {
    expect(trier(exemptees)).toContain('GET /api/health');
    expect(trier(corpsPropre)).not.toEqual([]);
    expect(corpsProbleme.size).toBeGreaterThanOrEqual(30);
  });

  it('n’a aucune opération au corps d’erreur propre qui ne soit exemptée en code', () => {
    const sansExemption = trier(corpsPropre).filter((o) => !exemptees.has(o));
    expect(sansExemption).toEqual([]);
  });

  it('ne documente jamais un problème sur une opération exemptée en code', () => {
    const contradictoires = trier(corpsProbleme).filter((o) =>
      exemptees.has(o),
    );
    expect(contradictoires).toEqual([]);
  });

  // La règle utile n'est pas « toutes en problem+json » mais « aucune muette » :
  // avant le lot 4, les 50 réponses d'erreur du document ne décrivaient AUCUN
  // corps, et le front en a lu un inexistant pendant toute la vie du produit.
  it('ne laisse aucune réponse d’erreur sans corps documenté', () => {
    const muettes: string[] = [];
    for (const [chemin, item] of Object.entries(gatewayOpenApiDocument.paths)) {
      for (const [verbe, operation] of Object.entries(item)) {
        const reponses = (operation as { responses?: Record<string, unknown> })
          .responses;
        for (const [statut, reponse] of Object.entries(reponses ?? {})) {
          if (!/^[45]\d\d$/.test(statut)) continue;
          const contenu = (reponse as { content?: unknown }).content;
          if (contenu === undefined) {
            muettes.push(`${verbe.toUpperCase()} ${chemin} ${statut}`);
          }
        }
      }
    }
    expect(muettes).toEqual([]);
  });
});

/**
 * Ce que le document **promet** en cas de succès, par opération : les statuts
 * `2xx` déclarés, et si le premier d'entre eux annonce un en-tête `Location`.
 */
function succesDocumentes(): Map<
  Operation,
  { statuts: number[]; location: boolean }
> {
  const parOperation = new Map<
    Operation,
    { statuts: number[]; location: boolean }
  >();
  for (const [chemin, item] of Object.entries(gatewayOpenApiDocument.paths)) {
    for (const [verbe, operation] of Object.entries(item)) {
      if (!VERBES.has(RequestMethod[verbe.toUpperCase() as 'GET'])) continue;
      const reponses =
        (operation as { responses?: Record<string, unknown> }).responses ?? {};
      const succes = Object.entries(reponses).filter(([statut]) =>
        /^2\d\d$/.test(statut),
      );
      const premier = succes[0]?.[1] as { headers?: object } | undefined;
      parOperation.set(`${verbe.toUpperCase()} ${chemin}`, {
        statuts: succes.map(([statut]) => Number(statut)),
        location: Object.hasOwn(premier?.headers ?? {}, 'Location'),
      });
    }
  }
  return parOperation;
}

/**
 * **Garde du statut de succès et de `Location` (lot 7, `AM-39`).**
 *
 * La garde de couverture ci-dessus confronte l'**existence** des opérations ;
 * elle ne dit rien de ce qu'elles **répondent**. Or le statut de succès d'un
 * `POST` Nest est un **défaut invisible** : sans `@HttpCode`, la réponse est un
 * 201, que le handler crée quelque chose ou non. Deux routes en vivaient — un
 * accusé de lecture et une validation de semaine — chacune documentée `200`
 * et servant `201`, sans qu'aucune des trois copies (code, contrat, types web)
 * ne puisse le dire. Compter les `@HttpCode(CREATED)` était d'ailleurs le
 * mauvais réflexe : il en sous-compte, il ne voit que les 201 **écrits**.
 *
 * Second volet : l'en-tête `Location` d'une création (RFC 9110 §10.2.2). Il est
 * posé par un intercepteur à partir du décorateur `@RessourceCreee`, donc
 * **constatable de l'extérieur** — même raison qu'`@ActeurCourant()` au lot 6 :
 * un décorateur se lit en métadonnée, une écriture au fond d'un handler ne se
 * lit pas. La garde exige l'accord dans les **deux sens**, le document étant la
 * troisième copie que rien ne tenait sémantiquement.
 */
describe('OpenAPI · statut de succès et Location (lot 7, AM-39)', () => {
  const routes = routesServies(AppModule);
  const documentes = succesDocumentes();

  // Anti-balayage-à-vide : sans routes vues des deux côtés, toutes les
  // comparaisons ci-dessous seraient des `[] === []` (piège appris en C1).
  it('voit les statuts des deux côtés (métadonnée Nest et document)', () => {
    expect(routes.length).toBeGreaterThanOrEqual(40);
    expect(documentes.size).toBeGreaterThanOrEqual(40);
    // Un 201 par défaut (aucun `@HttpCode`) et un 204 explicite : la dérivation
    // du statut servi doit distinguer les deux, sinon elle ne prouve rien.
    expect(
      routes.find((r) => r.operation === 'POST /api/v1/foyers')?.statut,
    ).toBe(201);
    expect(
      routes.find((r) => r.operation === 'DELETE /api/v1/foyers/{id}')?.statut,
    ).toBe(204);
  });

  it('documente exactement un statut de succès par opération', () => {
    const fautives = routes
      .filter((r) => documentes.get(r.operation)?.statuts.length !== 1)
      .map(
        (r) =>
          `${r.operation} → ${JSON.stringify(documentes.get(r.operation)?.statuts ?? [])}`,
      )
      .sort((a, b) => a.localeCompare(b));
    expect(fautives).toEqual([]);
  });

  it('documente le statut de succès réellement rendu par Nest', () => {
    const divergences = routes
      .filter((r) => {
        const statuts = documentes.get(r.operation)?.statuts ?? [];
        return statuts.length === 1 && statuts[0] !== r.statut;
      })
      .map(
        (r) =>
          `${r.operation} : servi ${String(r.statut)}, documenté ` +
          String(documentes.get(r.operation)?.statuts[0]),
      )
      .sort((a, b) => a.localeCompare(b));
    expect(divergences).toEqual([]);
  });

  it('ne pose de Location que sur une création (201)', () => {
    const horsCreation = routes
      .filter((r) => r.ressourceCreee && r.statut !== 201)
      .map((r) => `${r.operation} (statut ${String(r.statut)})`)
      .sort((a, b) => a.localeCompare(b));
    expect(horsCreation).toEqual([]);
  });

  it('documente un en-tête Location exactement là où le code en pose un', () => {
    const desaccords = routes
      .filter(
        (r) =>
          r.ressourceCreee !== (documentes.get(r.operation)?.location ?? false),
      )
      .map(
        (r) =>
          `${r.operation} : code ${r.ressourceCreee ? 'pose' : 'ne pose pas'}, ` +
          `contrat ${documentes.get(r.operation)?.location === true ? 'déclare' : 'ne déclare pas'}`,
      )
      .sort((a, b) => a.localeCompare(b));
    expect(desaccords).toEqual([]);
  });

  /**
   * L'URI que le `Location` désignera existe-t-elle dans l'API ? L'intercepteur
   * la compose comme « URL de la collection + identifiant rendu » : la cible est
   * donc le chemin de la route suivi d'**un** segment de paramètre. Un `Location`
   * vers une URI que l'API n'adresse pas serait un cul-de-sac ; la garde exige
   * qu'un `path` du contrat lui corresponde.
   *
   * **Ce qu'elle ne couvre pas**, et il faut le dire : elle prouve que l'URI
   * existe, pas que l'identifiant rendu soit celui de cette ressource-là. C'est
   * exactement l'angle mort de `POST /contrats/{id}/versions`, dont la cible
   * `…/versions/{versionId}` existe bel et bien, mais dont la réponse porte
   * l'identifiant du **contrat** — raison pour laquelle cette route est exclue à
   * la main, et non par cette garde.
   */
  it('vise une URI que le contrat adresse (Location jamais en cul-de-sac)', () => {
    const chemins = Object.keys(gatewayOpenApiDocument.paths);
    const orphelines = routes
      .filter((r) => r.ressourceCreee)
      .filter((r) => {
        const collection = r.operation.split(' ')[1] ?? '';
        return !chemins.some((chemin) =>
          new RegExp(
            `^${collection.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}/\\{[^/{}]+\\}$`,
          ).test(chemin),
        );
      })
      .map((r) => r.operation)
      .sort((a, b) => a.localeCompare(b));
    expect(orphelines).toEqual([]);
  });

  /**
   * Constat écrit plutôt que supposé : sur les sept URI créées, **une seule** se
   * lit en `GET` (`/foyers/{id}`) ; les six autres n'exposent que `PUT` et/ou
   * `DELETE`. Le `Location` y reste juste — la RFC 9110 §10.2.2 en fait l'URI de
   * la ressource créée, pas une promesse de lisibilité, et une URI qui accepte
   * `PUT`/`DELETE` **est** une ressource. Mais un client qui la suivrait en `GET`
   * prendrait un 404, et personne ne doit le découvrir en production.
   *
   * Ce test **fige la liste** : le jour où une lecture par identifiant est
   * ajoutée (ou retirée), il le dit. C'est la seule façon de garder le sujet
   * visible sans écrire une route qu'aucun écran ne demande.
   */
  it('dit lesquelles des URI créées se lisent en GET', () => {
    const chemins = new Set(Object.keys(gatewayOpenApiDocument.paths));
    const lisible = (operation: string): boolean => {
      const collection = operation.split(' ')[1] ?? '';
      for (const chemin of chemins) {
        if (!chemin.startsWith(`${collection}/{`)) continue;
        if (chemin.slice(collection.length + 1).includes('/')) continue;
        const item = gatewayOpenApiDocument.paths[
          chemin as keyof typeof gatewayOpenApiDocument.paths
        ] as Record<string, unknown>;
        if ('get' in item) return true;
      }
      return false;
    };
    const parLisibilite = routes
      .filter((r) => r.ressourceCreee)
      .map((r) => `${lisible(r.operation) ? 'GET' : '———'} ${r.operation}`)
      .sort((a, b) => a.localeCompare(b));
    expect(parLisibilite).toEqual([
      '——— POST /api/v1/contrats',
      '——— POST /api/v1/foyers/{foyerId}/etablissements',
      // Calendrier (SFD 31, lot 2) : la ressource créée s'adresse en
      // `PUT`/`DELETE` mais se LIT par sa collection (`GET …/periodes`,
      // `GET …/exceptions`), qui rend la couche entière à un instant de
      // connaissance donné. Une lecture par identifiant n'aurait de sens que
      // détachée de cet instant — donc pas de `GET` unitaire.
      '——— POST /api/v1/foyers/{foyerId}/etablissements/{id}/calendrier/exceptions',
      '——— POST /api/v1/foyers/{foyerId}/etablissements/{id}/calendrier/periodes',
      '——— POST /api/v1/foyers/{id}/enfants',
      '——— POST /api/v1/foyers/{id}/parents',
      'GET POST /api/v1/foyers',
    ]);
  });

  // Le périmètre déclaré de la garde, écrit en test plutôt qu'en prose : elle
  // exige l'accord code/contrat, jamais qu'une création **doive** poser un
  // `Location`. Sept 201 n'en posent pas, et chacune pour une raison constatée
  // (écart assumé du lot 7, cf. `docs/34-registre-ameliorations.md` `AM-39`) :
  // les quatre premières ne créent aucune ressource **adressable** (l'API
  // n'expose ni URI d'envoi ni URI de barème/grille) ; la cinquième en crée une
  // mais ne la nomme pas — `POST /contrats/{id}/versions` rend le contrat mis à
  // jour, l'identifiant de la version reste dans `svc-planification`.
  //
  // Les deux dernières viennent de la SFD 40, même raison que les quatre
  // premières : ni l'engagement d'unités associatives ni une session n'ont d'URI
  // propre — l'API n'expose qu'un `GET /unites-associatives` qui rend le suivi
  // ENTIER, parce que c'est lui l'objet utile (trois compteurs + échéance), pas
  // la ligne qu'on vient d'écrire.
  //
  // Cette liste est un **attendu écrit**, le seul de la garde : elle vaut
  // signature. Une création neuve sans `Location` la fait rougir, ce qui force à
  // dire pourquoi plutôt qu'à omettre.
  it('laisse exister des créations sans Location (périmètre déclaré)', () => {
    const sansLocation = routes
      .filter((r) => r.statut === 201 && !r.ressourceCreee)
      .map((r) => r.operation)
      .sort((a, b) => a.localeCompare(b));
    expect(sansLocation).toEqual([
      'POST /api/v1/contrats/{id}/versions',
      'POST /api/v1/notifications/envois/etablissement',
      'POST /api/v1/referentiel/baremes/psu',
      'POST /api/v1/referentiel/baremes/tranches',
      'POST /api/v1/referentiel/grilles',
      'POST /api/v1/unites-associatives',
      'POST /api/v1/unites-associatives/sessions',
    ]);
  });
});

describe('OpenAPI · résolution des URL (sondes du résolveur lui-même)', () => {
  @Controller({ path: 'exemples/:cle', version: '1' })
  class ExempleVersionne {
    @Get() lister(): string {
      return 'lister';
    }
    @Post(':id/sous/:sousId') creer(): string {
      return 'creer';
    }
    @Delete('/tranchant/') supprimer(): string {
      return 'supprimer';
    }
    /** Méthode publique SANS décorateur de route : ne doit pas être ramassée. */
    nonRoute(): string {
      return 'nonRoute';
    }
  }

  @Controller('transverse')
  class ExempleNeutre {
    @Get('sonde') sonder(): string {
      return 'sonder';
    }
  }

  @Controller()
  class ExempleRacine {
    @Get('fichier.json') servir(): string {
      return 'servir';
    }
  }

  it('applique le préfixe global, la version URI et convertit les paramètres', () => {
    expect(trier(operationsDuControleur(ExempleVersionne))).toEqual([
      'DELETE /api/v1/exemples/{cle}/tranchant',
      'GET /api/v1/exemples/{cle}',
      'POST /api/v1/exemples/{cle}/{id}/sous/{sousId}',
    ]);
  });

  it('laisse les contrôleurs sans version hors du segment /v1', () => {
    expect(operationsDuControleur(ExempleNeutre)).toEqual([
      'GET /api/transverse/sonde',
    ]);
    expect(operationsDuControleur(ExempleRacine)).toEqual([
      'GET /api/fichier.json',
    ]);
  });

  it('ignore les méthodes qui ne portent pas de décorateur de route', () => {
    expect(
      operationsDuControleur(ExempleVersionne).some((o) =>
        o.includes('nonRoute'),
      ),
    ).toBe(false);
  });

  /**
   * Sondes du **statut servi** : c'est la seule dérivation de cette garde qui
   * repose sur une connaissance du framework (le défaut par verbe) plutôt que
   * sur une métadonnée écrite. Si Nest changeait ce défaut, ou si la lecture de
   * `HTTP_CODE_METADATA` cessait de mordre, la garde deviendrait verte en
   * comparant deux fois le contrat à lui-même.
   */
  @Controller({ path: 'statuts', version: '1' })
  class ExempleStatuts {
    @Post('sans-httpcode') creer(): string {
      return 'creer';
    }
    @Post('avec-httpcode') @HttpCode(200) accuser(): string {
      return 'accuser';
    }
    @Get('lecture') lire(): string {
      return 'lire';
    }
    @Delete('sans-corps') @HttpCode(204) effacer(): string {
      return 'effacer';
    }
  }

  it('dérive 201 pour un POST nu, 200 pour les autres verbes, et lit @HttpCode', () => {
    const parOperation = new Map(
      routesDuControleur(ExempleStatuts).map((r) => [r.operation, r.statut]),
    );
    expect(parOperation.get('POST /api/v1/statuts/sans-httpcode')).toBe(201);
    expect(parOperation.get('POST /api/v1/statuts/avec-httpcode')).toBe(200);
    expect(parOperation.get('GET /api/v1/statuts/lecture')).toBe(200);
    expect(parOperation.get('DELETE /api/v1/statuts/sans-corps')).toBe(204);
  });

  it('ne voit une ressource créée que là où @RessourceCreee est posée', () => {
    @Controller({ path: 'creations', version: '1' })
    class ExempleCreations {
      @Post('avec')
      @RessourceCreee((vue: { id: string }) => vue.id)
      avec(): { id: string } {
        return { id: 'x' };
      }
      @Post('sans') sans(): { id: string } {
        return { id: 'y' };
      }
    }
    const parOperation = new Map(
      routesDuControleur(ExempleCreations).map((r) => [
        r.operation,
        r.ressourceCreee,
      ]),
    );
    expect(parOperation.get('POST /api/v1/creations/avec')).toBe(true);
    expect(parOperation.get('POST /api/v1/creations/sans')).toBe(false);
  });
});
