import { Inject, Injectable, Logger } from '@nestjs/common';
import { eq, sql } from 'drizzle-orm';
import {
  baremeTranchesPublieEventSchema,
  BAREME_TRANCHES_PUBLIE_TYPE,
} from '@creche-planner/contracts-referentiel';
import { DRIZZLE, type ResultatTraitement } from '@creche-planner/nest-commons';
import type { Database } from '../database/database.types.js';
import { baremeTranches, processedEvent } from '../database/schema.js';

/** Transaction Drizzle (type du callback `db.transaction`). */
type Tx = Parameters<Parameters<Database['transaction']>[0]>[0];

/**
 * Projette les événements d'intégration amont dans le read-model **local** de
 * `svc-foyer` (SFD 30, D2). Sa **première** infra de consommation : seul le barème de
 * seuils de tranche (`referentiel.BaremeTranchesPublie.v1`) est consommé, pour
 * dériver la tranche RFR à la date d'effet d'une version de ressources. Traitement
 * **idempotent** (marqueur `processed_event` posé dans la même transaction) et garde
 * de monotonie `occurred_at` (patron svc-tarification).
 */
@Injectable()
export class ProjectionService {
  private readonly logger = new Logger(ProjectionService.name);

  constructor(@Inject(DRIZZLE) private readonly db: Database) {}

  async traiter(stream: string, donnees: unknown): Promise<ResultatTraitement> {
    try {
      const type = this.typeDe(donnees);
      if (type === undefined) {
        return 'IGNORE_ENVELOPPE_INVALIDE';
      }
      switch (type) {
        case BAREME_TRANCHES_PUBLIE_TYPE:
          await this.appliquerBaremeTranchesPublie(stream, donnees);
          return 'TRAITE';
        default:
          return 'IGNORE_TYPE_INCONNU';
      }
    } catch (erreur) {
      this.logger.warn(
        `Projection échouée (${stream}) : ${(erreur as Error).message} — re-livraison`,
      );
      return 'ECHEC_TRANSITOIRE';
    }
  }

  /** Lit le champ `type` d'une enveloppe brute sans valider le payload. */
  private typeDe(donnees: unknown): string | undefined {
    if (
      typeof donnees === 'object' &&
      donnees !== null &&
      'type' in donnees &&
      typeof donnees.type === 'string'
    ) {
      return (donnees as { type: string }).type;
    }
    return undefined;
  }

  /**
   * Insère le marqueur d'idempotence ; renvoie `false` si déjà présent (doublon),
   * auquel cas l'appelant n'applique pas la projection.
   */
  private async marquerTraite(
    tx: Tx,
    id: string,
    stream: string,
    type: string,
  ): Promise<boolean> {
    const insere = await tx
      .insert(processedEvent)
      .values({ id, stream, type })
      .onConflictDoNothing({ target: processedEvent.id })
      .returning({ id: processedEvent.id });
    return insere.length > 0;
  }

  /**
   * Projette `referentiel.BaremeTranchesPublie.v1` dans le read-model `bareme_tranches`.
   * Upsert par `valide_du` avec garde de monotonie `occurred_at`.
   */
  private async appliquerBaremeTranchesPublie(
    stream: string,
    donnees: unknown,
  ): Promise<void> {
    const evt = baremeTranchesPublieEventSchema.parse(donnees);
    await this.db.transaction(async (tx) => {
      if (!(await this.marquerTraite(tx, evt.id, stream, evt.type))) {
        return;
      }
      const p = evt.payload;
      await tx
        .insert(baremeTranches)
        .values({
          id: p.baremeId,
          valideDu: p.valideDu,
          valideAu: p.valideAu,
          seuils: p.seuils,
          eventId: evt.id,
          occurredAt: new Date(evt.occurredAt),
          updatedAt: new Date(),
        })
        .onConflictDoUpdate({
          target: baremeTranches.valideDu,
          set: {
            valideAu: p.valideAu,
            seuils: p.seuils,
            eventId: evt.id,
            occurredAt: new Date(evt.occurredAt),
            updatedAt: new Date(),
          },
          setWhere: sql`${baremeTranches.occurredAt} is null or ${baremeTranches.occurredAt} <= excluded.occurred_at`,
        });
    });
  }

  /** Indique si un événement a déjà été traité (utilitaire de diagnostic/test). */
  async dejaTraite(id: string): Promise<boolean> {
    const lignes = await this.db
      .select()
      .from(processedEvent)
      .where(eq(processedEvent.id, id));
    return lignes.length > 0;
  }
}
