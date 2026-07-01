import { Inject, Injectable } from '@nestjs/common';
import { and, eq } from 'drizzle-orm';
import type { TypeNotification } from '@creche-planner/contracts-foyer';
import { DRIZZLE } from '@creche-planner/nest-commons';
import type { Database } from '../database/database.types.js';
import { foyerParent, preferenceNotification } from '../database/schema.js';

/** Canal e-mail (seul canal filtré par la résolution des destinataires du récap). */
const CANAL_EMAIL = 'EMAIL';

/** Canal in-app (inbox générique, PR6) : résolution des destinataires de l'inbox. */
const CANAL_IN_APP = 'IN_APP';

/** Destinataire e-mail résolu : e-mail **et** `parentId` (jeton de désabonnement PR5). */
export interface DestinataireActif {
  readonly parentId: string;
  readonly email: string;
}

/**
 * Résolution des **destinataires e-mail** du récap hebdomadaire à partir du read model
 * `foyer_parent` (projeté depuis le stream `FOYER`, cf. `ProjectionService`), **filtrée
 * par les préférences de notification** (read model `preference_notification`, PR4).
 * Rend les e-mails des parents **actifs** d'un foyer **dont le canal e-mail n'a pas été
 * coupé** pour le type demandé, le `principal` placé en tête puis tri alphabétique
 * stable — l'appelant (`SchedulerHebdo`) compose un unique `to` regroupant les contrats
 * fraîchement notifiés, et se replie sur `NOTIF_EMAIL_PARENT` (dépréciation progressive)
 * quand la liste est vide.
 */
@Injectable()
export class DestinatairesService {
  constructor(@Inject(DRIZZLE) private readonly db: Database) {}

  /**
   * E-mails des parents actifs du foyer **dont la préférence `(type, 'EMAIL')` est
   * active**, ordonnés `principal` d'abord puis par e-mail. Le filtre préférence suit la
   * règle §5.1 : **ligne absente ⇒ défaut applicatif (actif)** — un parent n'est retiré
   * que s'il existe une ligne `(parent, type, 'EMAIL')` explicitement `actif = false`
   * (jointure gauche : `preference_notification` NULL ⇒ défaut conservé). Liste vide si
   * le foyer n'a aucun parent joignable (l'appelant déclenche alors le repli vers
   * l'adresse globale).
   */
  async destinatairesActifs(
    foyerId: string,
    typeNotification: TypeNotification,
  ): Promise<DestinataireActif[]> {
    const lignes = await this.db
      .select({
        parentId: foyerParent.parentId,
        email: foyerParent.email,
        principal: foyerParent.principal,
        preferenceActive: preferenceNotification.actif,
      })
      .from(foyerParent)
      .leftJoin(
        preferenceNotification,
        and(
          eq(preferenceNotification.parentId, foyerParent.parentId),
          eq(preferenceNotification.typeNotification, typeNotification),
          eq(preferenceNotification.canal, CANAL_EMAIL),
        ),
      )
      .where(
        and(eq(foyerParent.foyerId, foyerId), eq(foyerParent.actif, true)),
      );
    return lignes
      .filter((l) => l.preferenceActive !== false) // NULL (défaut) ou true ⇒ conservé
      .slice()
      .sort(
        (a, b) =>
          Number(b.principal) - Number(a.principal) ||
          a.email.localeCompare(b.email),
      )
      .map((l) => ({ parentId: l.parentId, email: l.email }));
  }

  /**
   * Variante ne renvoyant que les **e-mails** (compat PR4). Le récap one-click (PR5)
   * utilise `destinatairesActifs` pour disposer aussi du `parentId` (jeton de
   * désabonnement lié au parent).
   */
  async emailsActifs(
    foyerId: string,
    typeNotification: TypeNotification,
  ): Promise<string[]> {
    return (await this.destinatairesActifs(foyerId, typeNotification)).map(
      (d) => d.email,
    );
  }

  /**
   * **Parents (ids) destinataires de l'inbox in-app** (PR6) : parents actifs du foyer
   * **dont la préférence `(type, 'IN_APP')` est active**. Même règle §5.1 que le canal
   * e-mail — **ligne absente ⇒ défaut applicatif (actif)** : un parent n'est retiré que
   * s'il a explicitement coupé son canal in-app pour ce type. Indépendant du canal
   * e-mail : un parent qui a coupé l'e-mail mais gardé l'in-app reçoit l'entrée
   * d'inbox (et inversement). Renvoie les `parentId` (l'inbox est keyée par parent) ;
   * l'ordre n'importe pas (une entrée par parent).
   */
  async destinatairesInApp(
    foyerId: string,
    typeNotification: TypeNotification,
  ): Promise<string[]> {
    const lignes = await this.db
      .select({
        parentId: foyerParent.parentId,
        preferenceActive: preferenceNotification.actif,
      })
      .from(foyerParent)
      .leftJoin(
        preferenceNotification,
        and(
          eq(preferenceNotification.parentId, foyerParent.parentId),
          eq(preferenceNotification.typeNotification, typeNotification),
          eq(preferenceNotification.canal, CANAL_IN_APP),
        ),
      )
      .where(
        and(eq(foyerParent.foyerId, foyerId), eq(foyerParent.actif, true)),
      );
    return lignes
      .filter((l) => l.preferenceActive !== false) // NULL (défaut) ou true ⇒ conservé
      .map((l) => l.parentId);
  }
}
