import { SetMetadata } from '@nestjs/common';

/**
 * **Origine du foyer/ressource** d'une route, déclarée par
 * `@ScopeFoyerInterServices(...)` et lue par le {@link ScopeFoyerGuard} (chantier
 * « fondations backend », lot 4). C'est l'**inventaire vivant, dans le code**, des
 * routes soumises au scoping par foyer côté service — le pendant aval de
 * `@FoyerScope(...)` de la gateway (`apps/api-gateway/src/security/foyer-scope.ts`),
 * **même vocabulaire** pour que le contrôle se lise pareil des deux côtés.
 *
 * Emplacement de la valeur (**exactement un** de) :
 * - `param` — paramètre de chemin (`/foyers/:id` → `{ param: 'id' }`) ;
 * - `query` — paramètre de requête (`?foyer=` → `{ query: 'foyer' }`) ;
 * - `body` — champ du corps JSON (`POST /contrats` → `{ body: 'foyerId' }`).
 *
 * Nature de la valeur :
 * - **directe** (défaut) : la valeur **est** un `foyerId` → exigence
 *   `foyerId ∈ assertion.foyers` ;
 * - `comparer: 'email'` : la valeur **est** un e-mail → exigence
 *   `email === assertion.email` (insensible à la casse), sans résolution en base
 *   (svc-foyer : `createurEmail` à la création, `parentEmail` en résolution) ;
 * - `resoudre: '<ressource>'` : la valeur est l'**id d'une ressource locale**
 *   (contrat, établissement, parent…) à résoudre en foyer/propriétaire via le
 *   {@link ResolveurFoyerRessource} du service (`{ resoudre: 'contrat', param: 'id' }`).
 *
 * @example
 *   @Get(':id') @ScopeFoyerInterServices({ param: 'id' }) obtenir(...) {}
 *   @Get() @ScopeFoyerInterServices({ query: 'foyer' }) lister(...) {}
 *   @Put(':id') @ScopeFoyerInterServices({ resoudre: 'contrat', param: 'id' }) modifier(...) {}
 */
export interface SourceScopeFoyer {
  /** Paramètre de chemin portant la valeur (`:id` → `param: 'id'`). */
  readonly param?: string;
  /** Paramètre de requête portant la valeur (`?foyer=` → `query: 'foyer'`). */
  readonly query?: string;
  /** Champ du corps JSON portant la valeur (`{ foyerId }` → `body: 'foyerId'`). */
  readonly body?: string;
  /**
   * Nom de la ressource **locale** à résoudre en foyer/propriétaire (via le
   * {@link ResolveurFoyerRessource}). Absent = valeur **directe** (foyerId, ou e-mail
   * si `comparer: 'email'`).
   */
  readonly resoudre?: string;
  /**
   * Nature d'une valeur **directe** (ignorée si `resoudre`) : `'foyer'` (défaut, la
   * valeur est un foyerId ⇒ inclusion dans `assertion.foyers`) ou `'email'` (la
   * valeur est un e-mail ⇒ égalité insensible à la casse avec `assertion.email`).
   */
  readonly comparer?: 'foyer' | 'email';
}

/** Clé de métadonnée portant la source du foyer/ressource d'une route (scoping aval). */
export const SCOPE_FOYER_KEY = 'interservices:scope-foyer';

/**
 * Déclare **où et comment** trouver le foyer (ou le propriétaire) d'une route, pour
 * que le {@link ScopeFoyerGuard} contrôle l'accès **côté service** (défense en
 * profondeur). Marque la route comme soumise au scoping par foyer : son absence
 * signifie « route non scopée » (le guard la laisse passer). Voir
 * {@link SourceScopeFoyer} pour les formes acceptées.
 */
export const ScopeFoyerInterServices = (
  source: SourceScopeFoyer,
): MethodDecorator & ClassDecorator => SetMetadata(SCOPE_FOYER_KEY, source);

/** Requête portant les emplacements de valeur lus par le scoping. */
export interface RequeteScope {
  readonly params?: Record<string, string | undefined>;
  readonly query?: Record<string, unknown>;
  readonly body?: Record<string, unknown>;
}

/** Emplacement effectif (type + nom) déclaré par une source, ou `undefined` si aucun. */
function emplacement(
  source: SourceScopeFoyer,
):
  | { readonly type: 'param' | 'query' | 'body'; readonly nom: string }
  | undefined {
  if (source.param !== undefined) {
    return { type: 'param', nom: source.param };
  }
  if (source.query !== undefined) {
    return { type: 'query', nom: source.query };
  }
  if (source.body !== undefined) {
    return { type: 'body', nom: source.body };
  }
  return undefined;
}

/**
 * Décrit une source pour les logs (« query:foyer », « resoudre contrat depuis param:id »).
 * Pure, sans I/O — sert au libellé du log « SCOPE AURAIT REFUSÉ ».
 */
export function decrireSource(source: SourceScopeFoyer): string {
  const lieu = emplacement(source);
  const cible = lieu ? `${lieu.type}:${lieu.nom}` : '?';
  return source.resoudre !== undefined
    ? `resoudre ${source.resoudre} depuis ${cible}`
    : cible;
}

/**
 * Extrait la **valeur brute** désignée par la source dans la requête (trimée), ou
 * `undefined` si absente/vide — le guard ne peut alors pas décider et laisse passer
 * (il ne casse pas une route mal annotée, comme `extraireRefFoyer` de la gateway).
 * Pure et testable. Lève une **erreur de configuration** si la source ne désigne
 * aucun emplacement (erreur de programmation dans un décorateur).
 */
export function lireValeurScope(
  source: SourceScopeFoyer,
  req: RequeteScope,
): string | undefined {
  const lieu = emplacement(source);
  if (lieu === undefined) {
    throw new Error(
      '@ScopeFoyerInterServices : la source doit désigner un param, une query ou un body',
    );
  }
  let brut: unknown;
  switch (lieu.type) {
    case 'param':
      brut = req.params?.[lieu.nom];
      break;
    case 'query':
      brut = req.query?.[lieu.nom];
      break;
    case 'body':
      brut = req.body?.[lieu.nom];
      break;
  }
  if (typeof brut !== 'string') {
    return undefined;
  }
  const valeur = brut.trim();
  return valeur === '' ? undefined : valeur;
}
