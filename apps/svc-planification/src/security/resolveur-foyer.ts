import { Inject, Injectable } from '@nestjs/common';
import { eq } from 'drizzle-orm';
import {
  DRIZZLE,
  type PorteeRessource,
  type ResolveurFoyerRessource,
} from '@creche-planner/nest-commons';
import type { Database } from '../database/database.types.js';
import { contrat, etablissement } from '../database/schema.js';

/**
 * Résolveur de portée (scoping aval, lot 4) de **svc-planification**, contre ses
 * **tables locales**. Deux ressources portent un `foyer_id` que les routes
 * `/contrats/:id…` et `/etablissements/:id` ne transportent pas directement :
 * - `contrat` : `select foyer_id from contrat where id = …` (couvre aussi
 *   `?contrat=` des prestations et sous-routes plannings/établissement/enfant) ;
 * - `etablissement` : `select foyer_id from etablissement where id = …`.
 *
 * Une ressource inexistante renvoie `null` → le guard laisse le handler répondre son
 * 404. Ne résout **jamais** « quels foyers a ce parent » (rôle de la gateway).
 */
@Injectable()
export class ResolveurFoyerPlanification implements ResolveurFoyerRessource {
  constructor(@Inject(DRIZZLE) private readonly db: Database) {}

  async resoudre(
    ressource: string,
    id: string,
  ): Promise<PorteeRessource | null> {
    switch (ressource) {
      case 'contrat':
        return this.foyerParTable(contrat, id);
      case 'etablissement':
        return this.foyerParTable(etablissement, id);
      default:
        throw new Error(
          `ResolveurFoyerPlanification : ressource inconnue « ${ressource} »`,
        );
    }
  }

  /** `select foyer_id from <table> where id = <id>` → portée foyer, ou `null` si absent. */
  private async foyerParTable(
    table: typeof contrat | typeof etablissement,
    id: string,
  ): Promise<PorteeRessource | null> {
    const [ligne] = await this.db
      .select({ foyerId: table.foyerId })
      .from(table)
      .where(eq(table.id, id))
      .limit(1);
    return ligne === undefined
      ? null
      : { type: 'foyer', foyerId: ligne.foyerId };
  }
}
