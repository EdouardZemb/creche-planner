/**
 * **Acteur d'une requête** — qui agit, tel que le service aval peut l'établir.
 *
 * L'identité n'est pas créée ici : elle est vérifiée au bord par la passerelle
 * (Cloudflare Access → `IdentiteGuard`), signée en assertion HMAC
 * ({@link ChargeAssertion}) et vérifiée par {@link AssertionIdentiteGuard}, qui
 * pose la charge sur la requête. Ce module ne fait que **traduire** cette charge
 * en un acteur nommable, persistable et journalisable (lot 6 du plan standards,
 * `AM-45`).
 *
 * Les trois cas sont **exhaustifs et tous réels** en production :
 *
 * - `parent` — assertion parent : l'e-mail a été vérifié au bord, c'est le cas
 *   nominal d'une action venue d'un écran ;
 * - `admin` — assertion parent portant `admin: true` : un e-mail de `ADMIN_EMAILS`,
 *   qui **contourne** l'appartenance au foyer (provisioning). Le distinguer n'est
 *   pas cosmétique : sans cela, une action d'exploitation sur le dossier de
 *   n'importe quel foyer s'écrirait `parent`, et l'export montrerait comme parent
 *   une adresse qui n'en est pas une. C'est exactement la confusion qu'une piste
 *   d'audit existe pour empêcher ;
 * - `service` — assertion machine : un service appelle un autre (relecture,
 *   repli, tâche de fond). Il n'y a **pas** de personne derrière l'action, et
 *   écrire un e-mail au hasard serait une fausse piste d'audit ;
 * - `inconnu` — aucune assertion vérifiée sur la requête. Ce n'est pas un cas
 *   théorique : tant que `INTERSERVICE_AUTHZ_ENFORCE` n'est pas basculé (mode
 *   observe, prod actuelle), une assertion absente ou invalide **laisse passer**
 *   la requête. La mutation a donc lieu, et sa trace doit le dire.
 *
 * Le choix qui compte est le troisième : on écrit la ligne d'audit **même sans
 * acteur**, avec `inconnu` en toutes lettres, plutôt que de ne rien écrire. Une
 * piste d'audit trouée est indiscernable d'une piste vide ; une piste qui
 * s'accuse elle-même est mesurable — et son compteur (`acteur="inconnu"`) est
 * exactement l'indicateur qui dira si la bascule enforce est sans risque.
 */

import type { ChargeAssertion } from './assertion-identite.js';

/** Acteur établi (ou non) d'une requête. Union discriminée exhaustive. */
export type Acteur =
  | { readonly type: 'parent'; readonly email: string }
  | { readonly type: 'admin'; readonly email: string }
  | { readonly type: 'service'; readonly nom: string }
  | { readonly type: 'inconnu' };

/** Aucun acteur établi : assertion absente, invalide, ou service en mode legacy. */
export const ACTEUR_INCONNU: Acteur = { type: 'inconnu' };

/**
 * Traduit une charge d'assertion **déjà vérifiée** en acteur. `undefined` (aucune
 * assertion posée sur la requête) donne {@link ACTEUR_INCONNU} : la fonction ne
 * devine jamais, elle rapporte.
 *
 * L'invariant « exactement un de `email` | `machine` » est garanti à la
 * vérification (`verifierAssertion` rejette un payload mixte ou vide) ; on le
 * relit tout de même dans l'ordre parent → service, sans repli implicite.
 */
export function acteurDepuisAssertion(
  charge: ChargeAssertion | undefined,
): Acteur {
  if (charge === undefined) {
    return ACTEUR_INCONNU;
  }
  if (charge.email !== undefined) {
    return charge.admin === true
      ? { type: 'admin', email: charge.email }
      : { type: 'parent', email: charge.email };
  }
  if (charge.machine !== undefined) {
    return { type: 'service', nom: charge.machine };
  }
  return ACTEUR_INCONNU;
}

/**
 * Désignation lisible de l'acteur, pour un journal applicatif ou un message.
 * Jamais utilisée comme **étiquette de métrique** : un e-mail y ferait exploser
 * la cardinalité et publierait une donnée personnelle dans Prometheus — les
 * compteurs n'étiquettent que le `type`.
 */
/**
 * **Identité nue** de l'acteur, telle qu'on la persiste : l'e-mail, ou le nom du
 * service, ou `null` quand il n'y en a pas. Distincte de {@link libelleActeur} : une
 * colonne accompagnée d'un `acteur_type` n'a pas à répéter la nature dans la valeur
 * — et `null` plutôt que le mot « inconnu », qui serait indiscernable d'un acteur
 * réellement nommé ainsi.
 */
export function identiteActeur(acteur: Acteur): string | null {
  switch (acteur.type) {
    case 'parent':
    case 'admin':
      return acteur.email;
    case 'service':
      return acteur.nom;
    case 'inconnu':
      return null;
  }
}

export function libelleActeur(acteur: Acteur): string {
  switch (acteur.type) {
    case 'parent':
      return acteur.email;
    case 'admin':
      return `admin:${acteur.email}`;
    case 'service':
      return `service:${acteur.nom}`;
    case 'inconnu':
      return 'inconnu';
  }
}
