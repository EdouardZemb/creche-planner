import { Inject, Injectable } from '@nestjs/common';
import { asc, eq, inArray } from 'drizzle-orm';
import { DRIZZLE } from '@creche-planner/nest-commons';
import type { Database } from '../database/database.types.js';
import {
  envoiEtablissement,
  envoiRecapHebdo,
  envoiRecapParent,
  foyerParent,
  notification,
  notificationHebdo,
} from '../database/schema.js';

/** Une semaine soumise à validation (`notification_hebdo`). */
export interface ExportValidationHebdo {
  readonly semaineIso: string;
  readonly contratId: string;
  readonly type: string;
  readonly statut: string;
  readonly notifieeLe: string;
  readonly valideeLe: string | null;
  readonly snapshot: unknown;
  readonly deltaModifs: unknown;
}

/** Un récapitulatif hebdomadaire adressé au foyer (`envoi_recap_hebdo`). */
export interface ExportEnvoiRecapHebdo {
  readonly semaineIso: string;
  readonly statut: string;
  readonly destinataires: unknown;
  readonly erreur: string | null;
  readonly envoyeLe: string | null;
  readonly creeLe: string;
}

/** La remise à un parent donné d'un récapitulatif (`envoi_recap_parent`). */
export interface ExportEnvoiRecapParent {
  readonly semaineIso: string;
  readonly parentId: string;
  readonly email: string;
  readonly statut: string;
  readonly essais: number;
  readonly erreur: string | null;
  readonly envoyeLe: string | null;
}

/** Un envoi à l'établissement, corps figé compris (`envoi_etablissement`). */
export interface ExportEnvoiEtablissement {
  readonly semaineIso: string;
  readonly etablissementId: string;
  readonly destinataire: string;
  readonly sujet: string;
  readonly corps: string;
  readonly statut: string;
  readonly erreur: string | null;
  readonly envoyeLe: string | null;
  readonly creeLe: string;
}

/** Un message de la boîte de réception in-app (`notification`). */
export interface ExportMessageInApp {
  readonly parentId: string;
  readonly type: string;
  readonly sujet: string;
  readonly corps: string;
  readonly lien: string | null;
  readonly creeLe: string;
  readonly luLe: string | null;
}

/** Part `svc-notifications` de l'export de portabilité d'un foyer. */
export interface ExportNotificationsVue {
  readonly validationsHebdo: readonly ExportValidationHebdo[];
  readonly envoisRecapFoyer: readonly ExportEnvoiRecapHebdo[];
  readonly envoisRecapParent: readonly ExportEnvoiRecapParent[];
  readonly envoisEtablissement: readonly ExportEnvoiEtablissement[];
  readonly messagesInApp: readonly ExportMessageInApp[];
}

/**
 * **Export de portabilité** de la part `svc-notifications` d'un foyer (lot 3 ;
 * `AM-35`). Ce service est le seul des trois à porter à la fois des copies et des
 * **sources** : les 5 tables exportées ici ne sont reconstructibles par aucune
 * re-projection — ce sont des faits datés (ce qui a été soumis à validation, ce
 * qui a réellement été envoyé, et à qui).
 *
 * Deux points qui ne s'improvisent pas :
 *
 * 1. **`notification` (boîte de réception) est clée par `parent_id`, sans
 *    `foyer_id`.** Les parents se résolvent donc localement par `foyer_parent`,
 *    exactement comme le fait l'effacement du lot 2a. `foyer_parent` est une
 *    **copie** de `svc-foyer.parent` : elle sert ici de table de résolution et
 *    n'est pas exportée — l'export des parents est rendu par sa source.
 * 2. **Le corps figé de `envoi_etablissement` est exporté tel quel.** Il porte les
 *    prénoms et le planning des enfants du foyer, et l'adresse de service de
 *    l'établissement — que le parent a lui-même saisie. C'est la preuve de ce qui
 *    est réellement parti en son nom ; la retirer viderait l'export de la seule
 *    donnée qu'il ne peut retrouver nulle part ailleurs. Les lignes anonymisées
 *    en place par la borne de rétention (lot 2b) sortent avec leur contenu vidé,
 *    ce qui est l'état réel de la base.
 */
@Injectable()
export class PortabiliteService {
  constructor(@Inject(DRIZZLE) private readonly db: Database) {}

  /**
   * Aucune levée si le foyer est inconnu de ce service : `svc-notifications` n'est
   * pas propriétaire du foyer, et un foyer qui n'a encore rien reçu est normal.
   */
  async exporter(foyerId: string): Promise<ExportNotificationsVue> {
    const [validations, recapsFoyer, recapsParent, envoisEtab, parents] =
      await Promise.all([
        this.db
          .select()
          .from(notificationHebdo)
          .where(eq(notificationHebdo.foyerId, foyerId))
          .orderBy(asc(notificationHebdo.semaineIso)),
        this.db
          .select()
          .from(envoiRecapHebdo)
          .where(eq(envoiRecapHebdo.foyerId, foyerId))
          .orderBy(asc(envoiRecapHebdo.semaineIso)),
        this.db
          .select()
          .from(envoiRecapParent)
          .where(eq(envoiRecapParent.foyerId, foyerId))
          .orderBy(asc(envoiRecapParent.semaineIso)),
        this.db
          .select()
          .from(envoiEtablissement)
          .where(eq(envoiEtablissement.foyerId, foyerId))
          .orderBy(asc(envoiEtablissement.semaineIso)),
        this.db
          .select({ parentId: foyerParent.parentId })
          .from(foyerParent)
          .where(eq(foyerParent.foyerId, foyerId)),
      ]);

    const messagesInApp = await this.lireMessages(
      parents.map((p) => p.parentId),
    );

    return {
      validationsHebdo: validations.map((v) => ({
        semaineIso: v.semaineIso,
        contratId: v.contratId,
        type: v.type,
        statut: v.statut,
        notifieeLe: v.notifieeLe.toISOString(),
        valideeLe: v.valideeLe?.toISOString() ?? null,
        snapshot: v.snapshot,
        deltaModifs: v.deltaModifs ?? null,
      })),
      envoisRecapFoyer: recapsFoyer.map((e) => ({
        semaineIso: e.semaineIso,
        statut: e.statut,
        destinataires: e.destinataires,
        erreur: e.erreur,
        envoyeLe: e.envoyeLe?.toISOString() ?? null,
        creeLe: e.creeLe.toISOString(),
      })),
      envoisRecapParent: recapsParent.map((e) => ({
        semaineIso: e.semaineIso,
        parentId: e.parentId,
        email: e.email,
        statut: e.statut,
        essais: e.essais,
        erreur: e.erreur,
        envoyeLe: e.envoyeLe?.toISOString() ?? null,
      })),
      envoisEtablissement: envoisEtab.map((e) => ({
        semaineIso: e.semaineIso,
        etablissementId: e.etablissementId,
        destinataire: e.destinataire,
        sujet: e.sujet,
        corps: e.corps,
        statut: e.statut,
        erreur: e.erreur,
        envoyeLe: e.envoyeLe?.toISOString() ?? null,
        creeLe: e.createdAt.toISOString(),
      })),
      messagesInApp,
    };
  }

  private async lireMessages(
    parentIds: readonly string[],
  ): Promise<ExportMessageInApp[]> {
    if (parentIds.length === 0) {
      return [];
    }
    const lignes = await this.db
      .select()
      .from(notification)
      .where(inArray(notification.parentId, [...parentIds]))
      .orderBy(asc(notification.creeLe));
    return lignes.map((n) => ({
      parentId: n.parentId,
      type: n.type,
      sujet: n.sujet,
      corps: n.corps,
      lien: n.lien,
      creeLe: n.creeLe.toISOString(),
      luLe: n.luLe?.toISOString() ?? null,
    }));
  }
}
