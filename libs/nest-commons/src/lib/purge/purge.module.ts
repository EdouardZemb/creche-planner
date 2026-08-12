import { type DynamicModule, Module } from '@nestjs/common';
import { CLOCK, horlogeSysteme } from '../common/clock.js';
import type { ColonnesDeadLetter } from '../messaging/dead-letter.options.js';
import type { ColonnesOutbox } from '../outbox/outbox.options.js';
import { DRIZZLE } from '../database/database.options.js';
import { OPTIONS_PURGE, type TachePurge } from './purge.options.js';
import { PurgeService } from './purge.service.js';

/**
 * Points de variance du module de purge, fournis par chaque service.
 *
 * `taches` reçoit la base **du service** : c'est là, et nulle part ailleurs, que
 * s'écrivent les prédicats propres à ses tables. Le paramètre est générique parce que les
 * types Drizzle d'une app (CJS) et de cette lib (ESM) ne s'unifient pas (TS2379/TS2375,
 * cf. `outbox.options.ts`) — l'inférence les garde du côté de l'appelant, et l'injection
 * Nest les efface au passage du jeton.
 */
export interface OptionsPurgeModule<
  TDb,
  TOutbox extends ColonnesOutbox,
  TDeadLetter extends ColonnesDeadLetter,
> {
  /** Table `outbox` du service, ou `null` s'il n'en publie pas. */
  readonly outbox: TOutbox | null;
  /** Table `dead_letter` du service, ou `null` s'il ne consomme pas. */
  readonly deadLetter: TDeadLetter | null;
  /** Bornes propres au service, construites avec sa base et ses tables. */
  readonly taches?: (db: TDb) => readonly TachePurge[];
}

/**
 * Câble les bornes temporelles d'un service. Un appel dans son `AppModule` suffit :
 * `DRIZZLE` est global (`DatabaseModule`) et l'horloge système est fournie ici — un test
 * remplace `CLOCK`, ou construit `PurgeService` directement.
 */
@Module({})
export class PurgeModule {
  static forRoot<
    TDb,
    TOutbox extends ColonnesOutbox,
    TDeadLetter extends ColonnesDeadLetter,
  >(options: OptionsPurgeModule<TDb, TOutbox, TDeadLetter>): DynamicModule {
    return {
      module: PurgeModule,
      providers: [
        { provide: CLOCK, useValue: horlogeSysteme },
        {
          provide: OPTIONS_PURGE,
          useFactory: (db: TDb) => ({
            outbox: options.outbox,
            deadLetter: options.deadLetter,
            taches: options.taches ? options.taches(db) : [],
          }),
          inject: [DRIZZLE],
        },
        PurgeService,
      ],
    };
  }
}
