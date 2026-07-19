/**
 * Résolution versionnée du catalogue tarifaire (grilles ABCM, barème PSU).
 *
 * Le socle est mutualisé dans le `shared-kernel` (SFD 30, D7) : `Versionne`,
 * `selectionnerVersionApplicable` et `verifierAbsenceChevauchement` y vivent
 * désormais. Ce module les ré-exporte sous leurs noms historiques pour préserver
 * l'API du domaine Référentiel (comportement bit-à-bit identique).
 */
export {
  type Versionne,
  selectionnerVersionApplicable,
  verifierAbsenceChevauchement,
} from '@creche-planner/shared-kernel';
