import { type DynamicModule, Module } from '@nestjs/common';
import { OPTIONS_NATS, type OptionsNats } from './nats.options.js';
import { NatsService } from './nats.service.js';

@Module({})
export class NatsModule {
  static forRoot(options: OptionsNats): DynamicModule {
    return {
      module: NatsModule,
      global: true,
      providers: [{ provide: OPTIONS_NATS, useValue: options }, NatsService],
      exports: [NatsService],
    };
  }
}
