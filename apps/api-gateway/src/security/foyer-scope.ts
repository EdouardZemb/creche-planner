import type { RequeteIdentifiable } from './identite.js';

/**
 * **Origine du `foyerId`** d'une route, déclarée par `@FoyerScope(...)` et lue par
 * le guard d'appartenance. C'est l'**inventaire vivant** des routes portant un
 * foyer : une route sans décorateur n'est **pas** soumise à l'autorisation par
 * foyer (création/bootstrap, `/moi`, annuaire établissements…).
 *
 * Forme `<type>:<nom>` :
 * - `param:<nom>` — paramètre de chemin dont la valeur **est** un foyerId
 *   (`/foyers/:id` → `param:id`, `/notifications/semaine/:foyerId/…` →
 *   `param:foyerId`) ;
 * - `query:<nom>` — paramètre de requête (`?foyer=` → `query:foyer`) ;
 * - `body:<nom>` — champ du corps JSON (`POST /contrats` → `body:foyerId`) ;
 * - `contrat:<nom>` — paramètre de chemin portant un **contratId** à **résoudre**
 *   en foyer (`/contrats/:id/…` → `contrat:id`), car ces routes ne portent pas le
 *   foyer directement.
 */
export type SourceFoyer =
  | `param:${string}`
  | `query:${string}`
  | `body:${string}`
  | `contrat:${string}`;

/** Référence de foyer extraite d'une requête, avant résolution éventuelle. */
export interface RefFoyer {
  /**
   * `'foyer'` : `valeur` **est** déjà le foyerId. `'contrat'` : `valeur` est un
   * contratId à résoudre en foyer (appel `svc-planification`).
   */
  readonly kind: 'foyer' | 'contrat';
  readonly valeur: string;
}

/** Lit la valeur brute désignée par `<type>:<nom>` dans la requête. */
function lireValeur(
  type: string,
  nom: string,
  req: RequeteIdentifiable,
): string | undefined {
  switch (type) {
    case 'param':
    case 'contrat':
      return req.params?.[nom];
    case 'query': {
      const v = req.query?.[nom];
      return typeof v === 'string' ? v : undefined;
    }
    case 'body': {
      const v = req.body?.[nom];
      return typeof v === 'string' ? v : undefined;
    }
    default:
      return undefined;
  }
}

/**
 * Extrait de la requête la **référence de foyer** déclarée par la source, ou
 * `undefined` si la valeur est absente/vide (le guard ne peut alors pas décider
 * et laisse passer — il ne casse pas une route mal annotée). Pure et testable.
 */
export function extraireRefFoyer(
  source: SourceFoyer,
  req: RequeteIdentifiable,
): RefFoyer | undefined {
  const sep = source.indexOf(':');
  const type = source.slice(0, sep);
  const nom = source.slice(sep + 1);
  const brut = lireValeur(type, nom, req)?.trim();
  if (brut === undefined || brut === '') {
    return undefined;
  }
  return { kind: type === 'contrat' ? 'contrat' : 'foyer', valeur: brut };
}
