import {
  METHOD_METADATA,
  MODULE_METADATA,
  PATH_METADATA,
  VERSION_METADATA,
} from '@nestjs/common/constants';
import { Controller, Delete, Get, Post, RequestMethod } from '@nestjs/common';
import { describe, expect, it } from 'vitest';
import { gatewayOpenApiDocument } from '@creche-planner/contracts-kernel';
import { AppModule } from '../app.module.js';

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
 */

/** Préfixe global posé par `configurerApp` (`app.setGlobalPrefix('api')`). */
const PREFIXE_GLOBAL = 'api';

/** Une opération HTTP servie : `GET /api/v1/foyers/{id}`. */
type Operation = string;

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

/** Opérations servies par un contrôleur, d'après ses métadonnées de décorateurs. */
function operationsDuControleur(controleur: ClasseControleur): Operation[] {
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
      const url = urlServie(
        versionControleur,
        Reflect.getMetadata(VERSION_METADATA, handler),
        cheminControleur,
        Reflect.getMetadata(PATH_METADATA, handler),
      );
      return [`${verbe.toUpperCase()} ${url}`];
    });
}

/**
 * Parcourt le graphe de modules depuis `racine` et rend toutes les opérations
 * servies. Traverse aussi les **modules dynamiques** (`X.forRoot()`), qui sont des
 * objets `{ module, imports, controllers }` et non des classes : les ignorer
 * rendrait la garde aveugle au jour où un module tiers exposerait une route.
 */
function operationsServies(racine: ClasseControleur): Set<Operation> {
  const vus = new Set<unknown>();
  const trouvees = new Set<Operation>();
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
        for (const operation of operationsDuControleur(
          controleur as ClasseControleur,
        )) {
          trouvees.add(operation);
        }
      }
    }

    const imports = lire(MODULE_METADATA.IMPORTS);
    if (estTableau(imports)) {
      aVisiter.push(...(imports as EntreeImport[]));
    }
  }

  return trouvees;
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
});
