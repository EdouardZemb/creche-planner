import type { TachePurge } from '@creche-planner/nest-commons';
import { and, isNotNull, isNull, lt, ne, or } from 'drizzle-orm';
import type { PgColumn } from 'drizzle-orm/pg-core';
import type { Database } from '../database/database.types.js';
import {
  envoiEtablissement,
  envoiRecapHebdo,
  envoiRecapParent,
  notification,
} from '../database/schema.js';

/**
 * T4 — boîte de réception applicative : **12 mois depuis la création**
 * (`docs/37-registre-des-traitements.md` §3).
 */
export const RETENTION_NOTIFICATION_JOURS = 365;

/**
 * T3 — preuves d'envoi : **13 mois depuis l'envoi** (une année scolaire pleine, plus la
 * rentrée suivante). 13 × 30,44 j, arrondi.
 */
export const RETENTION_PREUVE_ENVOI_JOURS = 396;

/**
 * Ancre d'âge d'une ligne d'envoi : la date d'aboutissement quand elle existe, sinon la
 * date de création.
 *
 * Le `COALESCE` n'est pas une commodité. `envoye_le` reste **nul** pour tout ce qui n'a
 * pas abouti — slot réservé jamais traité, envoi interrompu entre la réservation et sa
 * finalisation, créneau abandonné. Un prédicat sur `envoye_le` seul laisserait donc ces
 * lignes en base **pour toujours**, et ce sont précisément celles qui portent le plus de
 * données personnelles figées (adresses des destinataires). La purge paraîtrait réussie
 * en n'ayant rien fait là où il fallait agir.
 *
 * Ne **jamais** utiliser `maj_le` : il est réécrit à chaque transition d'état, ce n'est
 * pas une ancre d'âge mais une date de dernière touche.
 */
function plusVieilleQue(
  aboutissement: PgColumn,
  creation: PgColumn,
  borne: Date,
) {
  return or(
    and(isNotNull(aboutissement), lt(aboutissement, borne)),
    and(isNull(aboutissement), lt(creation, borne)),
  );
}

/**
 * T4 — boîte de réception in-app : suppression à 12 mois sur `cree_le`.
 *
 * Sûre parce que la table est bien ce que son schéma dit qu'elle est : un **journal en
 * ajout seul**. Ses trois lecteurs (liste, compteur de non-lus, marquage lu) ne portent
 * aucune action, et sa clé d'idempotence `(parent_id, "TYPE:semaine")` ne peut pas être
 * refrappée pour une semaine vieille de douze mois — le seul écrivain est le scheduler du
 * mardi, borné à la semaine suivante. Effet visible et assumé : une entrée non lue de plus
 * d'un an disparaît, et le compteur de la cloche baisse d'autant.
 *
 * ⚠️ `notification_hebdo` n'est **pas** traitée ici, bien que doc 37 §3 la range sur la
 * même ligne T4 : elle n'est pas un journal mais la **machine à états** de la validation
 * hebdomadaire, et l'absence d'une ligne y vaut « semaine jamais notifiée ». Écart assumé,
 * écrit en `docs/37-registre-des-traitements.md` §4.
 */
export function tachePurgeNotification(db: Database): TachePurge {
  return {
    nom: 'notification',
    retentionJours: RETENTION_NOTIFICATION_JOURS,
    executer: async (borne) => {
      const resultat = await db
        .delete(notification)
        .where(lt(notification.creeLe, borne));
      return resultat.count;
    },
  };
}

/**
 * T3 — journal d'envoi du récapitulatif au foyer : suppression à 13 mois.
 *
 * Sûre parce que le déclencheur est borné : le scheduler ne cible **jamais** qu'une seule
 * semaine, celle qui suit l'instant courant, et ne rattrape aucun arriéré. Une ligne de
 * treize mois ne peut donc pas être recréée, et sa suppression ne peut pas rouvrir un
 * envoi. Le seul balayage qui regarde en arrière (abandon des créneaux expirés) n'écrit
 * qu'un statut et n'envoie aucun courriel.
 *
 * `destinataires` est un tableau JSON d'adresses en clair : c'est la donnée personnelle
 * que cette borne retire.
 */
export function tachePurgeEnvoiRecapHebdo(db: Database): TachePurge {
  return {
    nom: 'envoi_recap_hebdo',
    retentionJours: RETENTION_PREUVE_ENVOI_JOURS,
    executer: async (borne) => {
      const resultat = await db
        .delete(envoiRecapHebdo)
        .where(
          plusVieilleQue(
            envoiRecapHebdo.envoyeLe,
            envoiRecapHebdo.creeLe,
            borne,
          ),
        );
      return resultat.count;
    },
  };
}

/**
 * T3 — registre de livraison par parent : suppression à 13 mois. Même raisonnement que
 * `envoi_recap_hebdo`, dont il est le détail par destinataire ; `email` y est figé en
 * clair.
 */
export function tachePurgeEnvoiRecapParent(db: Database): TachePurge {
  return {
    nom: 'envoi_recap_parent',
    retentionJours: RETENTION_PREUVE_ENVOI_JOURS,
    executer: async (borne) => {
      const resultat = await db
        .delete(envoiRecapParent)
        .where(
          plusVieilleQue(
            envoiRecapParent.envoyeLe,
            envoiRecapParent.creeLe,
            borne,
          ),
        );
      return resultat.count;
    },
  };
}

/**
 * T3 — récapitulatif adressé à un établissement : **anonymisation en place à 13 mois, pas
 * suppression**. C'est le seul endroit du lot où la borne ne supprime pas la ligne, et
 * c'est délibéré.
 *
 * Cette ligne **est** le garde-fou anti-double-envoi vers une vraie crèche, et rien
 * d'autre ne joue ce rôle : l'unicité `(foyer, semaine, établissement)` fait retomber un
 * second envoi sur la ligne existante, qui est alors rendue telle quelle sans solliciter
 * le mailer. Or l'endpoint d'envoi n'est **borné par aucune date** — ni au BFF, ni au
 * service : la semaine n'est validée qu'en forme. Et le front ne consulte pas l'état
 * persisté pour réarmer son bouton (le « déjà envoyé » ne vit que dans un état local,
 * remis à zéro à chaque montage). Supprimer la ligne, c'est donc rendre possible un
 * second courriel réel vers l'adresse d'une crèche — la même famille de piège que
 * purger `processed_event`, mais côté sortant.
 *
 * L'anonymisation satisfait la borne sans désarmer la garde : le corps rendu, le sujet,
 * l'adresse du destinataire et l'identifiant de message partent ; la ligne-témoin
 * `(foyer, semaine, établissement, statut, envoye_le)` reste. Aucun lecteur n'en souffre —
 * la reprise d'envoi ne lit pas le corps, et la liste des mois déjà communiqués ne lit que
 * la semaine et le statut.
 *
 * `destinataire`, `sujet` et `corps` sont `NOT NULL` : on écrit la chaîne vide, et c'est
 * elle qui sert de garde d'idempotence (`corps <> ''`) pour qu'un second passage ne
 * recompte pas les mêmes lignes.
 */
export function tacheAnonymisationEnvoiEtablissement(db: Database): TachePurge {
  return {
    nom: 'envoi_etablissement_anonymisation',
    retentionJours: RETENTION_PREUVE_ENVOI_JOURS,
    executer: async (borne) => {
      const resultat = await db
        .update(envoiEtablissement)
        .set({
          destinataire: '',
          sujet: '',
          corps: '',
          messageId: null,
          erreur: null,
        })
        .where(
          and(
            plusVieilleQue(
              envoiEtablissement.envoyeLe,
              envoiEtablissement.createdAt,
              borne,
            ),
            ne(envoiEtablissement.corps, ''),
          ),
        );
      return resultat.count;
    },
  };
}

/** Bornes temporelles propres à `svc-notifications` (lot 2b). */
export function tachesPurgeNotifications(db: Database): readonly TachePurge[] {
  return [
    tachePurgeNotification(db),
    tachePurgeEnvoiRecapHebdo(db),
    tachePurgeEnvoiRecapParent(db),
    tacheAnonymisationEnvoiEtablissement(db),
  ];
}
