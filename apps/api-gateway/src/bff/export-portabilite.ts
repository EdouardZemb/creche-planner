import type { ExportFoyerVue } from '../clients/foyer.client.js';
import type { ExportNotificationsVue } from '../clients/notifications.client.js';
import type { ExportPlanificationVue } from '../clients/planification.client.js';
import type { ExportUnitesAssociativesVue } from '../clients/tarification.client.js';

/**
 * Version du **format** du document d'export, pas de l'application. Elle
 * n'augmente que si la forme change d'une façon qu'un lecteur du fichier
 * remarquerait — section renommée, section retirée. Ajouter une section est
 * additif et ne la fait pas bouger.
 */
export const VERSION_FORMAT_EXPORT = 1;

/**
 * Document d'export de portabilité d'un foyer (lot 3, `AM-35`). Les trois
 * sections portent le nom de ce qu'elles contiennent pour la personne, pas celui
 * du service qui les détient : un fichier téléchargé est lu par un humain, à qui
 * le découpage en microservices ne veut rien dire.
 */
export interface ExportPortabiliteVue {
  readonly versionFormat: number;
  readonly genereLe: string;
  readonly foyerId: string;
  readonly situationFoyer: ExportFoyerVue;
  readonly gardeEtPlanning: ExportPlanificationVue;
  readonly communications: ExportNotificationsVue;
  /**
   * Engagement de bénévolat du foyer et sessions saisies (SFD 40). Section
   * **ajoutée** au format, ce qui est additif : `VERSION_FORMAT_EXPORT` ne bouge
   * pas — un lecteur du fichier ne perd rien, il trouve une section de plus.
   */
  readonly engagementAssociatif: ExportUnitesAssociativesVue;
}

/** Les trois parts de service, telles que rendues par les clients. */
export interface PartsExport {
  readonly foyerId: string;
  readonly genereLe: string;
  readonly foyer: ExportFoyerVue;
  readonly planification: ExportPlanificationVue;
  readonly notifications: ExportNotificationsVue;
  readonly unitesAssociatives: ExportUnitesAssociativesVue;
}

/**
 * Assemble le document final. Fonction **pure** (aucune I/O, aucune horloge) :
 * l'instant de génération est fourni par l'appelant, comme `semaine-besoins.ts`
 * le fait de ses entrées — c'est ce qui rend l'assemblage testable sans figer le
 * temps, et ce qui empêche un `new Date()` de se glisser dans un patron partagé
 * (`LE-34`).
 */
export function assemblerExport(parts: PartsExport): ExportPortabiliteVue {
  return {
    versionFormat: VERSION_FORMAT_EXPORT,
    genereLe: parts.genereLe,
    foyerId: parts.foyerId,
    situationFoyer: parts.foyer,
    gardeEtPlanning: parts.planification,
    communications: parts.notifications,
    engagementAssociatif: parts.unitesAssociatives,
  };
}
