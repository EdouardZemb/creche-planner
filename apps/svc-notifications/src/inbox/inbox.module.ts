import { Module } from '@nestjs/common';
import { InboxController } from './inbox.controller.js';
import { InboxService } from './inbox.service.js';

/**
 * Module **inbox in-app** (PR6, §5.6). Expose le panneau/accusé de lecture des
 * notifications d'un parent (`InboxController`) et fournit `InboxService` — consommé
 * aussi par le `SchedulerModule` (création d'une entrée in-app au canal `IN_APP`). Le
 * client Drizzle vient du module global `DatabaseModule`.
 */
@Module({
  controllers: [InboxController],
  providers: [InboxService],
  exports: [InboxService],
})
export class InboxModule {}
