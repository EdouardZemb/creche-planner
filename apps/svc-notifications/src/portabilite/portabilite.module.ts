import { Module } from '@nestjs/common';
import { PortabiliteController } from './portabilite.controller.js';
import { PortabiliteService } from './portabilite.service.js';

@Module({
  controllers: [PortabiliteController],
  providers: [PortabiliteService],
})
export class PortabiliteModule {}
