import { randomUUID } from 'node:crypto';
import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import { and, desc, eq, isNull } from 'drizzle-orm';
import { DRIZZLE } from '@creche-planner/nest-commons';
import type { Database } from '../database/database.types.js';
import { notification } from '../database/schema.js';

/** Nombre maximal d'entrées renvoyées dans le panneau (les plus récentes). */
const LIMITE_PANNEAU = 50;

/** Une ligne de l'inbox in-app telle qu'exposée au BFF (dates en ISO 8601). */
export interface NotificationInAppVue {
  readonly id: string;
  readonly type: string;
  readonly sujet: string;
  readonly corps: string;
  readonly creeLe: string;
  readonly luLe: string | null;
}

/** Panneau de l'inbox : les entrées récentes + le compteur de non-lus (cloche). */
export interface InboxVue {
  readonly notifications: readonly NotificationInAppVue[];
  readonly nonLus: number;
}

/** Entrée à archiver dans l'inbox (créée au fil de l'envoi, cf. `SchedulerHebdo`). */
export interface CreerNotificationInApp {
  readonly parentId: string;
  readonly type: string;
  readonly sujet: string;
  readonly corps: string;
}

/**
 * Service de l'**inbox in-app** (PR6, §5.6). Écrit et lit le journal `notification`
 * d'un parent. C'est un journal **informationnel** (lu/non-lu) : il ne duplique pas
 * l'action « Valider » (portée par `notification_hebdo` / l'encart `A_VALIDER`), il
 * archive simplement qu'une notification a été émise sur le canal in-app.
 *
 * Écriture : `creer`, appelée par le scheduler du mardi lorsqu'un parent a la
 * préférence `(type, 'IN_APP')` active — au **même moment** que l'envoi e-mail.
 * Lecture : `lister` (panneau + compteur de non-lus) et `marquerLu` (accusé de
 * lecture), toutes deux **scopées au parent** (défense en profondeur : on ne lit / ne
 * marque jamais l'entrée d'un autre parent). Le parent est résolu côté BFF depuis
 * l'identité vérifiée ; ce service le reçoit déjà résolu.
 */
@Injectable()
export class InboxService {
  constructor(@Inject(DRIZZLE) private readonly db: Database) {}

  /** Archive une notification in-app pour un parent (journal append-only). */
  async creer(entree: CreerNotificationInApp): Promise<void> {
    await this.db.insert(notification).values({
      id: randomUUID(),
      parentId: entree.parentId,
      type: entree.type,
      sujet: entree.sujet,
      corps: entree.corps,
    });
  }

  /**
   * Panneau d'un parent : ses notifications les plus récentes (limite `LIMITE_PANNEAU`,
   * tri antéchronologique) et le nombre total de non-lus. Le compteur de non-lus n'est
   * **pas** borné par la limite d'affichage : il compte toutes les lignes `lu_le IS NULL`
   * du parent (la cloche reflète le vrai reste-à-lire même au-delà de 50 entrées).
   */
  async lister(parentId: string): Promise<InboxVue> {
    const lignes = await this.db
      .select()
      .from(notification)
      .where(eq(notification.parentId, parentId))
      .orderBy(desc(notification.creeLe))
      .limit(LIMITE_PANNEAU);
    const nonLus = await this.compterNonLus(parentId);
    return { notifications: lignes.map((l) => this.versVue(l)), nonLus };
  }

  /**
   * Marque une notification du parent comme lue (`lu_le = now()`, idempotent : re-marquer
   * une entrée déjà lue est un no-op qui renvoie son état). Le filtre `parent_id` garantit
   * qu'un parent ne peut marquer que **ses** entrées ; une entrée absente pour ce parent
   * lève `404` (id inconnu ou appartenant à un autre parent — même message, pas de fuite).
   */
  async marquerLu(parentId: string, id: string): Promise<NotificationInAppVue> {
    const [ligne] = await this.db
      .update(notification)
      .set({ luLe: new Date() })
      .where(and(eq(notification.id, id), eq(notification.parentId, parentId)))
      .returning();
    if (ligne === undefined) {
      throw new NotFoundException('notification inconnue');
    }
    return this.versVue(ligne);
  }

  /** Compte les notifications non lues d'un parent (compteur de la cloche). */
  private async compterNonLus(parentId: string): Promise<number> {
    const lignes = await this.db
      .select({ id: notification.id })
      .from(notification)
      .where(
        and(eq(notification.parentId, parentId), isNull(notification.luLe)),
      );
    return lignes.length;
  }

  /** Projette une ligne base en vue BFF (horodatages sérialisés en ISO 8601). */
  private versVue(
    ligne: typeof notification.$inferSelect,
  ): NotificationInAppVue {
    return {
      id: ligne.id,
      type: ligne.type,
      sujet: ligne.sujet,
      corps: ligne.corps,
      creeLe: ligne.creeLe.toISOString(),
      luLe: ligne.luLe ? ligne.luLe.toISOString() : null,
    };
  }
}
