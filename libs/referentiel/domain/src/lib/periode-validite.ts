/**
 * Période de validité du catalogue tarifaire versionné (doc 02 §4.4 bis).
 *
 * Le socle de résolution temporelle est désormais **mutualisé** dans le
 * `shared-kernel` (SFD 30, D7) : une seule implémentation pour grilles, contrats,
 * foyer et travail. Ce module la ré-exporte sous son nom historique pour préserver
 * l'API du domaine Référentiel (comportement bit-à-bit identique).
 */
export { PeriodeValidite } from '@creche-planner/shared-kernel';
