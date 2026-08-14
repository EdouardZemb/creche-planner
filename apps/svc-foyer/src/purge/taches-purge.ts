import type { TachePurge } from '@creche-planner/nest-commons';
import { and, isNotNull, isNull, lt, or } from 'drizzle-orm';
import type { Database } from '../database/database.types.js';
import { desabonnementToken, journalAudit } from '../database/schema.js';

/**
 * T3bis — jetons de désabonnement : **3 ans depuis la dernière modification**
 * (`docs/37-registre-des-traitements.md` §3).
 */
export const RETENTION_DESABONNEMENT_TOKEN_JOURS = 3 * 365;

/**
 * Borne des jetons de désabonnement, ancrée sur la **dernière modification** de la ligne :
 * un jeton consommé se juge sur `utilise_le`, un jeton jamais consommé sur `emis_le`.
 * `utilise_le` est le seul champ jamais réécrit après l'émission (prise atomique
 * one-shot), donc « la dernière des deux dates » est bien la dernière modification.
 *
 * Les deux ancrages naïfs sont faux, chacun à sa manière — c'est pour cela que les deux
 * régimes sont écrits :
 *
 * - `utilise_le` **seul** : la colonne est nulle tant que le jeton n'a pas servi, et un
 *   jeton part à chaque récapitulatif hebdomadaire pour chaque destinataire. La quasi
 *   totalité du volume est donc non utilisée, et une comparaison sur `NULL` ne la
 *   sélectionne jamais : la borne garderait tout le déchet et n'effacerait **que** les
 *   preuves. Exactement l'inverse de l'intention.
 * - `emis_le` **seul** : effacerait la preuve trois ans après l'**envoi du courriel**, et
 *   non trois ans après l'exercice du droit.
 *
 * Car `utilise_le` **est** une preuve, et la seule qui survive :
 * [ADR-0006](../../../../docs/adr/0006-preferences-notification-et-desabonnement.md)
 * justifie l'existence même de cette table par l'audit — et `preference_notification` ne
 * prend pas le relais, sa colonne `desabonne_at` étant remise à nul dès que le parent se
 * réabonne (l'upsert écrase en place, il n'existe aucun historique des préférences).
 *
 * Aucun lien vivant n'est cassé : un jeton porte sa propre expiration dans sa signature,
 * valable `DESABONNEMENT_TOKEN_TTL_JOURS` (défaut 30 j), et il est rejeté sur signature
 * bien avant d'atteindre la base. La garde qui le vérifie est dans `taches-purge.spec.ts`,
 * et elle **dérive** le TTL de la configuration au lieu de le recopier.
 */
export function tachePurgeDesabonnementToken(db: Database): TachePurge {
  return {
    nom: 'desabonnement_token',
    retentionJours: RETENTION_DESABONNEMENT_TOKEN_JOURS,
    executer: async (borne) => {
      const resultat = await db.delete(desabonnementToken).where(
        or(
          // Jeton consommé : la preuve de l'exercice du droit vieillit depuis son usage.
          and(
            isNotNull(desabonnementToken.utiliseLe),
            lt(desabonnementToken.utiliseLe, borne),
          ),
          // Jeton jamais consommé : mort depuis longtemps, il vieillit depuis l'émission.
          and(
            isNull(desabonnementToken.utiliseLe),
            lt(desabonnementToken.emisLe, borne),
          ),
        ),
      );
      return resultat.count;
    },
  };
}

/**
 * T9 — piste d'audit acteur : **3 ans depuis l'action**
 * (`docs/37-registre-des-traitements.md` §3).
 */
export const RETENTION_JOURNAL_AUDIT_JOURS = 3 * 365;

/**
 * Borne de la piste d'audit (lot 6), ancrée sur `cree_le` — la table est en **ajout
 * seul**, sa date de création est donc aussi sa date de dernière modification, et
 * c'est le seul cas simple des bornes de ce service.
 *
 * Ce qui ne va pas de soi, c'est de la borner **du tout**, et l'arbitrage mérite
 * d'être écrit parce qu'il n'est pas symétrique.
 *
 * Le registre assigne 3 ans à l'historique versionné des ressources (T1) et au
 * journal de corrections (T1bis) — mais ces deux lignes sont **écartées** (⛔) : leur
 * point de départ n'existe pas en base, et rien ne les purge aujourd'hui. La piste
 * d'audit, elle, a une ancre propre. La borner à 3 ans la fait donc **mourir avant ce
 * qu'elle documente** : passé ce délai, une correction rétroactive subsistera sans son
 * auteur. C'est le prix assumé, et il se paie dans ce sens-là plutôt que dans l'autre
 * pour une raison précise : la piste est le seul des trois à porter une donnée
 * personnelle **de l'acteur** — une adresse e-mail qui, sans borne, s'accumulerait
 * sans terme ni nécessité. Le fond de la trace (l'avant/après de la correction)
 * survit sans elle ; c'est l'inverse qui serait irrécupérable.
 *
 * Le jour où T1/T1bis deviennent outillées, cette durée se relit avec elles.
 *
 * `LE-35` s'applique-t-elle ? Non : personne n'interprète l'**absence** d'une ligne
 * ici. Aucune règle métier ne lit cette table — ni garde, ni machine à états, ni
 * anti-double-envoi ; ses seuls lecteurs sont l'export de portabilité et un humain.
 * Une ligne purgée est une trace perdue, pas un comportement changé.
 */
export function tachePurgeJournalAudit(db: Database): TachePurge {
  return {
    nom: 'journal_audit',
    retentionJours: RETENTION_JOURNAL_AUDIT_JOURS,
    executer: async (borne) => {
      const resultat = await db
        .delete(journalAudit)
        .where(lt(journalAudit.creeLe, borne));
      return resultat.count;
    },
  };
}

/**
 * Bornes temporelles de `svc-foyer` (lot 2b, étendues au lot 6).
 * `correction_journal` **n'y figure pas** : la durée que le registre lui assigne part
 * de la **date d'effet de la version**, colonne que la table ne porte pas — cf.
 * l'écart assumé en `docs/37-registre-des-traitements.md` §4.
 */
export function tachesPurgeFoyer(db: Database): readonly TachePurge[] {
  return [tachePurgeDesabonnementToken(db), tachePurgeJournalAudit(db)];
}
