import type {
  ColonnesDeadLetter,
  TableDeadLetter,
} from '../messaging/dead-letter.options.js';
import type { ColonnesOutbox, TableOutbox } from '../outbox/outbox.options.js';

/**
 * Points de variance des **bornes temporelles** de rétention (lot 2b du plan standards).
 *
 * Le partage s'arrête à la cadence, la réentrance, l'horloge et l'observabilité — plus
 * les deux tables techniques dont le dépôt garantit déjà la forme (`outbox`,
 * `dead_letter`). Tout autre **prédicat** reste écrit dans le service, table par table et
 * colonne par colonne, et arrive ici sous forme de `TachePurge` : une fermeture qui ne
 * porte plus aucun type Drizzle.
 *
 * Ce n'est pas un détail de style, c'est une garde. `occurred_at` n'est pas propre à
 * l'outbox : il sert aussi de colonne « dernière écriture gagne » sur plusieurs read
 * models — dont `preference_notification`, où l'**absence** d'une ligne vaut consentement.
 * Une purge générique du type « toute table portant un `occurred_at` plus vieux que N »
 * réabonnerait tous les parents. On ne devine donc jamais ni la table ni la colonne.
 */

/** Jeton d'injection des options de purge d'un service. */
export const OPTIONS_PURGE = Symbol('OPTIONS_PURGE');

/**
 * Une borne temporelle. `executer` reçoit la borne **déjà calculée** par le service
 * (instant de l'horloge injectée moins `retentionJours`) et rend le nombre de lignes
 * traitées — supprimées, ou anonymisées quand la ligne elle-même doit survivre.
 *
 * Aucun type Drizzle n'apparaît ici, à dessein : les types vus par une app (CJS) et par
 * cette lib (ESM) ne s'unifient pas (TS2379/TS2375, cf. `outbox.options.ts`). Une tâche
 * propre à un service se construit donc **dans** le service, avec sa base et ses tables.
 */
export interface TachePurge {
  /** Nom stable, porté en attribut de métrique et dans les journaux (ex. `outbox`). */
  readonly nom: string;
  /** Durée de conservation, en jours (source : `docs/37-registre-des-traitements.md` §3). */
  readonly retentionJours: number;
  /** Applique la borne. Rend le nombre de lignes traitées. */
  readonly executer: (borne: Date) => Promise<number>;
}

/**
 * Options résolues, injectées au service de purge. `outbox` et `dead_letter` sont
 * **explicitement nullables** plutôt qu'optionnelles : un service doit déclarer qu'il n'a
 * pas la table, pas l'omettre — `svc-referentiel` n'a pas de `dead_letter`, et la table
 * `outbox` de `svc-tarification` est déclarée mais morte (aucun `OutboxModule`, aucun
 * insert), y borner quoi que ce soit ferait tourner un DELETE éternellement stérile.
 */
export interface OptionsPurge<
  TOutbox extends ColonnesOutbox = TableOutbox,
  TDeadLetter extends ColonnesDeadLetter = TableDeadLetter,
> {
  /** Table `outbox` du service, ou `null` s'il n'en publie pas. */
  readonly outbox: TOutbox | null;
  /** Table `dead_letter` du service, ou `null` s'il ne consomme pas. */
  readonly deadLetter: TDeadLetter | null;
  /** Bornes propres au service, construites avec sa base et ses tables. */
  readonly taches: readonly TachePurge[];
}

/**
 * Durées **mutualisées** des tables techniques, écrites une seule fois pour tous les
 * services. Source : `docs/37-registre-des-traitements.md` §3, ligne T7.
 */

/** `outbox` : 30 jours **après publication effective**. */
export const RETENTION_OUTBOX_JOURS = 30;

/** `dead_letter` : 90 jours après le rebut. */
export const RETENTION_DEAD_LETTER_JOURS = 90;
