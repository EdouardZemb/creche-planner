import { Inject, Injectable } from '@nestjs/common';
import { eq } from 'drizzle-orm';
import {
  DRIZZLE,
  type PorteeRessource,
  type ResolveurFoyerRessource,
} from '@creche-planner/nest-commons';
import type { Database } from '../database/database.types.js';
import { contrat, foyerParent } from '../database/schema.js';

/**
 * Résolveur de portée (scoping aval, lot 4) de **svc-notifications**, contre ses
 * **read models locaux** (projetés depuis les streams amont) :
 * - `contrat` : la validation `POST /validations/:contratId/:semaineIso` porte un
 *   contratId → `select foyer_id from contrat where id = …` (`foyer_id NOT NULL`) ;
 * - `parent` : l'inbox `?parent=` porte un parentId → `select email from foyer_parent
 *   where parent_id = …`, comparé à l'e-mail de l'assertion (portée « propriétaire »,
 *   le parent ne lit que **ses** notifications, pas celles de son co-parent).
 *
 * Ressource inexistante → `null` (le handler répond son 404 / son inbox vide). Ne
 * résout **jamais** « quels foyers a ce parent » (rôle de la gateway).
 */
@Injectable()
export class ResolveurFoyerNotifications implements ResolveurFoyerRessource {
  constructor(@Inject(DRIZZLE) private readonly db: Database) {}

  async resoudre(
    ressource: string,
    id: string,
  ): Promise<PorteeRessource | null> {
    switch (ressource) {
      case 'contrat': {
        const [ligne] = await this.db
          .select({ foyerId: contrat.foyerId })
          .from(contrat)
          .where(eq(contrat.id, id))
          .limit(1);
        return ligne === undefined
          ? null
          : { type: 'foyer', foyerId: ligne.foyerId };
      }
      case 'parent': {
        const [ligne] = await this.db
          .select({ email: foyerParent.email })
          .from(foyerParent)
          .where(eq(foyerParent.parentId, id))
          .limit(1);
        return ligne === undefined
          ? null
          : { type: 'proprietaire', email: ligne.email };
      }
      default:
        throw new Error(
          `ResolveurFoyerNotifications : ressource inconnue « ${ressource} »`,
        );
    }
  }
}
