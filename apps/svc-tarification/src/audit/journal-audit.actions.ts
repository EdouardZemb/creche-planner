/**
 * **Registre des actions de la piste d'audit** de `svc-tarification` (doc 37 §7).
 *
 * Le service n'en avait pas : jusqu'à la SFD 40 il ne servait que des lectures, et
 * ses seules écritures venaient d'un consommateur d'événements — un chemin sans
 * acteur humain, par construction. Les unités associatives sont sa **première**
 * saisie, et `RM-40-08` demande la piste « dès le premier commit, jamais en
 * différé » : la voici avec elle.
 *
 * C'est l'inventaire, dans le code, de ce que la piste sait tracer. La porte
 * `pnpm acteur` le lit pour confronter, dans les deux sens, les routes de mutation
 * des contrôleurs et le tableau §7 du registre des traitements.
 *
 * Les valeurs sont **stockées en base** (`journal_audit.action`) : les renommer
 * périme l'historique. Un nom se choisit `<ressource>.<verbe au participe>`.
 */
export const ACTIONS_AUDIT = {
  /** Déclaration de l'engagement de bénévolat d'une période (US-40-01). */
  ENGAGEMENT_UA_DECLARE: 'engagement_ua.declare',
  /** Ajout d'une session — la recopie d'un créneau pris sur le site travaux. */
  SESSION_UA_AJOUTEE: 'session_ua.ajoutee',
  /**
   * Changement d'état ou de contenu d'une session. C'est l'action qui déplace des
   * heures d'un compteur à l'autre — donc celle qui change le coût projeté du
   * foyer. Elle est tracée pour cette raison, pas pour la forme.
   */
  SESSION_UA_MODIFIEE: 'session_ua.modifiee',
  /**
   * Suppression d'une session : `DELETE` réel, aucune ligne ne survit pour porter
   * l'acteur. La distinguer d'une annulation (`etat = ANNULEE`) est le sujet même
   * de la ligne : l'une garde la trace du créneau, l'autre l'efface.
   */
  SESSION_UA_SUPPRIMEE: 'session_ua.supprimee',
} as const;

/** Une des actions du registre. */
export type ActionAudit = (typeof ACTIONS_AUDIT)[keyof typeof ACTIONS_AUDIT];

/** Natures de ressource visées par une action de ce service. */
export const CIBLES_AUDIT = ['engagement_ua', 'session_ua'] as const;

/** Nature de la ressource visée par une action. */
export type CibleAudit = (typeof CIBLES_AUDIT)[number];
