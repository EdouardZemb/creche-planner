import { Inject, Injectable } from '@nestjs/common';
import { and, eq } from 'drizzle-orm';
import { DRIZZLE } from '@creche-planner/nest-commons';
import type { Database } from '../database/database.types.js';
import { foyerParent } from '../database/schema.js';

/**
 * Résolution des **destinataires** du récap hebdomadaire à partir du read model
 * `foyer_parent` (projeté depuis le stream `FOYER`, cf. `ProjectionService`). Rend les
 * e-mails des parents **actifs** d'un foyer, le `principal` placé en tête puis tri
 * alphabétique stable — l'appelant (`SchedulerHebdo`) compose un unique `to`
 * regroupant les contrats fraîchement notifiés, et se replie sur `NOTIF_EMAIL_PARENT`
 * (dépréciation progressive) quand la liste est vide.
 */
@Injectable()
export class DestinatairesService {
  constructor(@Inject(DRIZZLE) private readonly db: Database) {}

  /**
   * E-mails des parents actifs du foyer, ordonnés `principal` d'abord puis par e-mail.
   * Liste vide si le foyer n'a aucun parent actif projeté (l'appelant déclenche alors
   * le repli vers l'adresse globale).
   */
  async emailsActifs(foyerId: string): Promise<string[]> {
    const lignes = await this.db
      .select()
      .from(foyerParent)
      .where(
        and(eq(foyerParent.foyerId, foyerId), eq(foyerParent.actif, true)),
      );
    return lignes
      .slice()
      .sort(
        (a, b) =>
          Number(b.principal) - Number(a.principal) ||
          a.email.localeCompare(b.email),
      )
      .map((l) => l.email);
  }
}
