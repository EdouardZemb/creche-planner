import { randomUUID } from 'node:crypto';
import { Inject, Injectable, Logger } from '@nestjs/common';
import { and, eq, ne } from 'drizzle-orm';
import {
  enfantModifieEventSchema,
  ENFANT_MODIFIE_TYPE,
} from '@creche-planner/contracts-foyer';
import {
  CONTRAT_MODIFIE_TYPE,
  type ContratModifiePayload,
  type ModeContrat,
} from '@creche-planner/contracts-planification';
import {
  DRIZZLE,
  traceIdCourant,
  type ResultatTraitement,
} from '@creche-planner/nest-commons';
import type { Database } from '../database/database.types.js';
import { contrat, outbox, processedEvent } from '../database/schema.js';

/** Transaction Drizzle (type du callback `db.transaction`). */
type Tx = Parameters<Parameters<Database['transaction']>[0]>[0];

/**
 * Projette les événements **enfant** du stream `FOYER` sur les contrats : le prénom
 * `contrat.enfant` est une **dénormalisation d'affichage** dont la référence est
 * `contrat.enfant_id` ; quand l'enfant est renommé côté `svc-foyer`
 * (`foyer.EnfantModifie.v1`), on rafraîchit le prénom de tous ses contrats et on
 * **ré-émet `ContratModifie`** par contrat touché (outbox, même transaction) pour
 * que les read-models aval (`svc-notifications`, `svc-tarification`) se rafraîchissent
 * sans changement de code chez eux.
 *
 * Idempotence : chaque enveloppe est marquée dans `processed_event` **dans la même
 * transaction** que la mise à jour — un rejeu at-least-once JetStream est un no-op
 * (en particulier, pas de double ré-émission `ContratModifie`).
 *
 * `EnfantAjoute`/`EnfantRetire` sont acquittés sans action : la création de contrat
 * porte déjà l'`enfantId`, et retirer un enfant ne supprime pas ses contrats (geste
 * explicite de l'utilisateur).
 */
@Injectable()
export class ProjectionService {
  private readonly logger = new Logger(ProjectionService.name);

  constructor(@Inject(DRIZZLE) private readonly db: Database) {}

  /**
   * Traite un message brut d'un stream et renvoie un {@link ResultatTraitement}
   * qui dit au consommateur quoi en faire : `TRAITE` (appliqué ou ignoré
   * proprement → ACK), `IGNORE_ENVELOPPE_INVALIDE`/`IGNORE_TYPE_INCONNU`
   * (dead-letter + ACK), `ECHEC_TRANSITOIRE` (erreur transitoire → NAK, ou
   * dead-letter au bout des livraisons). Aucun message ne disparaît en silence.
   */
  async traiter(stream: string, donnees: unknown): Promise<ResultatTraitement> {
    try {
      const type = this.typeDe(donnees);
      if (type === undefined) {
        return 'IGNORE_ENVELOPPE_INVALIDE'; // pas une enveloppe reconnue
      }
      switch (type) {
        case ENFANT_MODIFIE_TYPE:
          await this.appliquerEnfantModifie(stream, donnees);
          return 'TRAITE';
        default:
          return 'IGNORE_TYPE_INCONNU'; // type non consommé par Planification
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
   * `EnfantModifie` : rafraîchit le prénom dénormalisé des contrats rattachés à
   * l'enfant (`enfant_id`) dont le prénom stocké diffère, puis ré-émet un
   * `ContratModifie` (état complet, prénom rafraîchi) **par contrat touché**. Les
   * contrats historiques sans `enfant_id` (back-fill en attente) ne sont pas
   * touchés — le rapprochement par prénom est du ressort du back-fill, pas d'un
   * renommage (ambigu par nature).
   */
  private async appliquerEnfantModifie(
    stream: string,
    donnees: unknown,
  ): Promise<void> {
    const evt = enfantModifieEventSchema.parse(donnees);
    await this.db.transaction(async (tx) => {
      if (!(await this.marquerTraite(tx, evt.id, stream, evt.type))) {
        return;
      }
      const p = evt.payload;
      const rafraichis = await tx
        .update(contrat)
        .set({ enfant: p.prenom, updatedAt: new Date() })
        .where(
          and(eq(contrat.enfantId, p.enfantId), ne(contrat.enfant, p.prenom)),
        )
        .returning();
      for (const ligne of rafraichis) {
        const payload: ContratModifiePayload = {
          contratId: ligne.id,
          foyerId: ligne.foyerId,
          enfant: ligne.enfant,
          enfantId: ligne.enfantId,
          mode: ligne.mode as ModeContrat,
          valideDu: ligne.valideDu,
          valideAu: ligne.valideAu,
          etablissementId: ligne.etablissementId,
          // État complet ré-émis : la première inscription ABCM (lot 4a) doit
          // survivre au renommage d'un enfant (sinon le champ « clignote »).
          premiereInscription: ligne.premiereInscription,
        };
        await tx.insert(outbox).values({
          id: randomUUID(),
          type: CONTRAT_MODIFIE_TYPE,
          payload,
          traceId: traceIdCourant(),
        });
      }
      if (rafraichis.length > 0) {
        this.logger.log(
          `Prénom rafraîchi sur ${String(rafraichis.length)} contrat(s) de l'enfant ${p.enfantId} (« ${p.prenom} »)`,
        );
      }
    });
  }
}
