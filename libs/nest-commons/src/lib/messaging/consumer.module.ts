import {
  type DynamicModule,
  Module,
  type ModuleMetadata,
  type Type,
} from '@nestjs/common';
import { PROJECTION_PORT, type ProjectionPort } from './consumer.types.js';
import {
  type ColonnesDeadLetter,
  OPTIONS_CONSUMER,
  type OptionsConsumer,
  type TableDeadLetter,
} from './dead-letter.options.js';
import { DeadLetterService } from './dead-letter.service.js';
import { JetStreamConsumer } from './jetstream-consumer.js';

/** Options de `ConsumerModule.forRoot`, fournies par chaque service. */
export interface OptionsConsumerModule<
  TTable extends ColonnesDeadLetter = TableDeadLetter,
> extends OptionsConsumer<TTable> {
  /**
   * Classe `ProjectionService` du service (implémente `ProjectionPort`). Elle est
   * fournie **dans** ce module et exposée sous le jeton `PROJECTION_PORT` ; ses
   * dépendances (DRIZZLE, NatsService, clients de repli globaux…) doivent être
   * résolubles globalement ou via `imports`.
   */
  projection: Type<ProjectionPort>;
  /** Modules à importer pour résoudre les dépendances de `projection`, si besoin. */
  imports?: ModuleMetadata['imports'];
}

/**
 * Module dynamique du consommateur JetStream mutualisé + dead-letter (pattern
 * `OutboxModule.forRoot`). Fournit `JetStreamConsumer` et `DeadLetterService`
 * paramétrés par les abonnements et la table `dead_letter` du service, et lie le
 * `PROJECTION_PORT` à la projection du service.
 */
@Module({})
export class ConsumerModule {
  static forRoot<TTable extends ColonnesDeadLetter>(
    options: OptionsConsumerModule<TTable>,
  ): DynamicModule {
    const optionsConsumer: OptionsConsumer<TTable> = {
      abonnements: options.abonnements,
      tableDeadLetter: options.tableDeadLetter,
    };
    return {
      module: ConsumerModule,
      imports: options.imports ?? [],
      providers: [
        { provide: OPTIONS_CONSUMER, useValue: optionsConsumer },
        options.projection,
        { provide: PROJECTION_PORT, useExisting: options.projection },
        DeadLetterService,
        JetStreamConsumer,
      ],
      exports: [options.projection, PROJECTION_PORT, DeadLetterService],
    };
  }
}
