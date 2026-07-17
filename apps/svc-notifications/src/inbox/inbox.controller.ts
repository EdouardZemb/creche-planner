import {
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
} from '@nestjs/common';
import { ScopeFoyerInterServices } from '@creche-planner/nest-commons';
import {
  InboxService,
  type InboxVue,
  type NotificationInAppVue,
} from './inbox.service.js';

/**
 * Inbox in-app générique (`/api/moi/notifications`, PR6 §5.6). Deux endpoints,
 * **scopés au parent** passé en paramètre (le BFF le résout côté gateway depuis
 * l'identité vérifiée, jamais le client — même patron que `?foyer=` de la
 * validation). La forme du `parentId` / de l'`id` est vérifiée par `ParseUUIDPipe` ;
 * la logique (tri, compteur, accusé de lecture) vit dans le service.
 */
@Controller('moi/notifications')
export class InboxController {
  constructor(private readonly inbox: InboxService) {}

  /** Panneau + compteur de non-lus d'un parent : `?parent=<uuid>`. */
  @ScopeFoyerInterServices({ resoudre: 'parent', query: 'parent' })
  @Get()
  lister(@Query('parent', ParseUUIDPipe) parentId: string): Promise<InboxVue> {
    return this.inbox.lister(parentId);
  }

  /**
   * Marque la notification `:id` du parent `?parent=<uuid>` comme lue (idempotent).
   * **404** si l'id est inconnu **ou** appartient à un autre parent (même message).
   */
  @ScopeFoyerInterServices({ resoudre: 'parent', query: 'parent' })
  @Post(':id/lu')
  @HttpCode(HttpStatus.OK)
  marquerLu(
    @Param('id', ParseUUIDPipe) id: string,
    @Query('parent', ParseUUIDPipe) parentId: string,
  ): Promise<NotificationInAppVue> {
    return this.inbox.marquerLu(parentId, id);
  }
}
