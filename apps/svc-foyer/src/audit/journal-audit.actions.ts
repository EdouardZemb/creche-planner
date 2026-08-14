/**
 * **Registre des actions de la piste d'audit** de `svc-foyer` (lot 6, `AM-45`).
 *
 * C'est l'inventaire, dans le code, de ce que la piste sait tracer. La porte
 * `pnpm acteur` le lit pour confronter, dans les deux sens, les routes de mutation
 * des contrôleurs et le tableau §7 de `docs/37-registre-des-traitements.md` : une
 * action déclarée ici et jamais consignée est morte, une route auditée qui nomme
 * une action absente d'ici est un mensonge de documentation.
 *
 * Les valeurs sont **stockées en base** (`journal_audit.action`) : les renommer
 * périme l'historique. Un nom se choisit `<ressource>.<verbe au participe>`.
 */
export const ACTIONS_AUDIT = {
  /** Création du foyer et de son dossier initial (enfants + parents). */
  FOYER_CREE: 'foyer.cree',
  /** Nouvelle version de ressources à une date d'effet encore inoccupée. */
  RESSOURCES_SAISIES: 'foyer.ressources.saisies',
  /**
   * Réécriture d'une version existante — correction **rétroactive** : elle change
   * un tarif déjà facturé. La ligne de `correction_journal` en porte l'avant/après ;
   * celle-ci en porte l'auteur.
   */
  RESSOURCES_CORRIGEES: 'foyer.ressources.corrigees',
  /**
   * Effacement du foyer entier. **Jamais persistée** : la table part en cascade avec
   * le foyer, et l'insertion après le `DELETE` violerait la clé étrangère. Journal
   * applicatif seul — cf. `JournalAuditService.consignerHorsBase`.
   */
  FOYER_EFFACE: 'foyer.efface',
  ENFANT_AJOUTE: 'enfant.ajoute',
  ENFANT_MODIFIE: 'enfant.modifie',
  /** Retrait d'un enfant : `DELETE` réel, aucune ligne ne survit pour porter l'acteur. */
  ENFANT_RETIRE: 'enfant.retire',
  /** Ajout **ou réactivation** d'un parent — dans les deux cas, un accès est ouvert. */
  PARENT_AJOUTE: 'parent.ajoute',
  PARENT_MODIFIE: 'parent.modifie',
  /** Retrait d'un parent : révocation de l'accès d'une personne au foyer. */
  PARENT_RETIRE: 'parent.retire',
  /** Changement des préférences de notification d'un parent depuis un écran. */
  PREFERENCES_MODIFIEES: 'parent.preferences.modifiees',
} as const;

/** Une des actions du registre. */
export type ActionAudit = (typeof ACTIONS_AUDIT)[keyof typeof ACTIONS_AUDIT];

/**
 * Natures de ressource visées. `foyer_version` et `correction_journal` sont
 * distinguées à dessein : une correction crée **une ligne de journal par
 * correction**, alors qu'une même version peut être corrigée plusieurs fois — viser
 * la version rendrait le rapprochement ambigu, viser la ligne de correction le rend
 * exact.
 */
export const CIBLES_AUDIT = [
  'foyer',
  'foyer_version',
  'correction_journal',
  'enfant',
  'parent',
] as const;

/** Nature de la ressource visée par une action. */
export type CibleAudit = (typeof CIBLES_AUDIT)[number];
