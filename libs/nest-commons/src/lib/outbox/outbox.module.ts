import { type DynamicModule, Module } from '@nestjs/common';
import {
  type ColonnesOutbox,
  OPTIONS_OUTBOX,
  type OptionsOutbox,
} from './outbox.options.js';
import { OutboxRelay } from './outbox.relay.js';

@Module({})
export class OutboxModule {
  static forRoot<TTable extends ColonnesOutbox>(
    options: OptionsOutbox<TTable>,
  ): DynamicModule {
    return {
      module: OutboxModule,
      providers: [{ provide: OPTIONS_OUTBOX, useValue: options }, OutboxRelay],
    };
  }
}
