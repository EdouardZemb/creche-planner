import { and, isNotNull, lt } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import type { TableDeadLetter } from '../messaging/dead-letter.options.js';
import type { TableOutbox } from '../outbox/outbox.options.js';
import {
  RETENTION_DEAD_LETTER_JOURS,
  RETENTION_OUTBOX_JOURS,
  type TachePurge,
} from './purge.options.js';

/**
 * Borne de l'`outbox` : supprime les événements **publiés** depuis plus de
 * `RETENTION_OUTBOX_JOURS`. Écrite ici, une seule fois, parce que les quatre services
 * porteurs doivent partager exactement ce prédicat — et parce que se tromper de colonne
 * coûterait un effacement RGPD annulé en silence (ci-dessous).
 *
 * ⚠️ **`published_at IS NOT NULL` n'est pas une optimisation, c'est la garde.** L'outbox
 * est une file de publication **vivante**, pas un magasin : une ligne dont `published_at`
 * est nul est un événement **en vol**, que le relais republiera. Elle peut être
 * arbitrairement ancienne — le relais s'arrête net si NATS est déconnecté, et un
 * événement durablement refusé fige la tête de file (son `catch` enveloppe la boucle
 * entière, le cycle suivant resélectionne les mêmes lignes). Ancrer la borne sur
 * `occurred_at` détruirait ces lignes-là ; au premier rang `foyer.FoyerSupprime.v1`, seul
 * porteur survivant de l'effacement d'un foyer une fois la transaction source commitée
 * (lot 2a) — les trois services aval ne recevraient jamais l'effacement, sans retour
 * possible et sans que rien ne le détecte.
 */
export function tachePurgeOutbox(
  db: PostgresJsDatabase,
  table: TableOutbox,
  retentionJours: number = RETENTION_OUTBOX_JOURS,
): TachePurge {
  return {
    nom: 'outbox',
    retentionJours,
    executer: async (borne) => {
      const resultat = await db
        .delete(table)
        .where(and(isNotNull(table.publishedAt), lt(table.publishedAt, borne)));
      return resultat.count;
    },
  };
}

/**
 * Borne de `dead_letter` : supprime les rebuts vieux de plus de
 * `RETENTION_DEAD_LETTER_JOURS`, sur `created_at` (nom identique dans les quatre copies).
 *
 * C'est le meilleur rendement du lot : `payload` est du texte **en clair**, et tout
 * événement du stream qu'un service ne consomme pas y atterrit avec son contenu — revenus
 * et adresses e-mail compris (`AM-53`). L'effacement à la demande du lot 2a n'y suffit
 * pas : il apparie le foyer par un `like` sur le payload, or celui-ci est **tronqué à
 * 64 Ko** ; un identifiant tombé au-delà de la troncature n'est jamais apparié, et la
 * borne temporelle est alors le seul mécanisme qui enlève ces lignes.
 *
 * Deux limites assumées, écrites pour qu'elles ne soient pas découvertes plus tard :
 * `dead_letter` est la **dernière copie** d'un message déjà retiré de JetStream (le
 * consommateur a acquitté ou terminé), donc la purge rend définitivement irréparable un
 * événement jamais appliqué ; et son seul lecteur est **humain** — le runbook de l'alerte
 * `ConsumerRejets`. 90 jours laissent largement le temps de traiter une alerte.
 */
export function tachePurgeDeadLetter(
  db: PostgresJsDatabase,
  table: TableDeadLetter,
  retentionJours: number = RETENTION_DEAD_LETTER_JOURS,
): TachePurge {
  return {
    nom: 'dead_letter',
    retentionJours,
    executer: async (borne) => {
      const resultat = await db.delete(table).where(lt(table.createdAt, borne));
      return resultat.count;
    },
  };
}
