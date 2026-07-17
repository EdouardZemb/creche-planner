import { Inject, Injectable, Logger } from '@nestjs/common';
import { metrics } from '@opentelemetry/api';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { DRIZZLE } from '../database/database.options.js';
import type { RaisonRejet } from './consumer.types.js';
import {
  OPTIONS_CONSUMER,
  type OptionsConsumer,
} from './dead-letter.options.js';

/** Taille maximale du payload conservé en dead-letter (64 Ko). */
const PAYLOAD_MAX = 64 * 1024;

/**
 * Compteur OTel des rejets de messages, exporté en Prometheus sous
 * `consumer_rejets_total{stream, raison}` (le label `service.name` est ajouté par
 * le collector). Si aucun `MeterProvider` n'est enregistré, l'API OTel est un
 * no-op silencieux (sûr et sans effet de bord). Modèle d'émission :
 * `apps/svc-tarification/src/fallback/planification.client.ts`.
 */
const meter = metrics.getMeter('nest-commons.messaging');
const compteurRejets = meter.createCounter('consumer_rejets_total', {
  description:
    'Messages JetStream non traités, enregistrés en dead-letter (par stream et raison).',
});

/** Paramètres d'un enregistrement dead-letter. */
export interface EntreeDeadLetter {
  readonly envelopeId: string | null;
  readonly stream: string;
  readonly sujet: string;
  readonly raison: RaisonRejet;
  readonly payload: string;
  readonly erreur: string | null;
  readonly livraisons: number;
}

/**
 * Enregistre en base **et** compte les messages qu'un consommateur JetStream n'a
 * pas pu traiter, pour qu'aucun événement (validation de semaine, modification de
 * foyer…) ne disparaisse en silence. La table cible est fournie par le service
 * (`OptionsConsumer.tableDeadLetter`) ; l'insertion et le compteur sont mutualisés.
 */
@Injectable()
export class DeadLetterService {
  private readonly logger = new Logger(DeadLetterService.name);

  constructor(
    @Inject(DRIZZLE) private readonly db: PostgresJsDatabase,
    @Inject(OPTIONS_CONSUMER) private readonly options: OptionsConsumer,
  ) {}

  /**
   * Insère une ligne `dead_letter` et incrémente `consumer_rejets_total`. Best
   * effort : une défaillance d'écriture est journalisée mais ne relance pas
   * d'exception (le consommateur a déjà décidé d'acquitter/terminer le message —
   * on ne veut pas rebloquer le stream sur l'échec de la trace elle-même).
   */
  async enregistrer(entree: EntreeDeadLetter): Promise<void> {
    compteurRejets.add(1, { stream: entree.stream, raison: entree.raison });
    try {
      await this.db.insert(this.options.tableDeadLetter).values({
        envelopeId: entree.envelopeId,
        stream: entree.stream,
        sujet: entree.sujet,
        raison: entree.raison,
        payload: entree.payload.slice(0, PAYLOAD_MAX),
        erreur: entree.erreur,
        livraisons: entree.livraisons,
      });
      this.logger.warn(
        `Dead-letter ${entree.raison} sur ${entree.sujet}@${entree.stream}` +
          (entree.envelopeId ? ` (env ${entree.envelopeId})` : ''),
      );
    } catch (erreur) {
      this.logger.error(
        `Échec d'écriture dead-letter (${entree.raison}@${entree.stream}) : ${(erreur as Error).message}`,
      );
    }
  }
}
