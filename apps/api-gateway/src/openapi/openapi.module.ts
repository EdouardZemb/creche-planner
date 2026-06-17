import { Module } from '@nestjs/common';
import { OpenApiController } from './openapi.controller.js';

/** Module exposant la spécification OpenAPI de la gateway. */
@Module({
  controllers: [OpenApiController],
})
export class OpenApiModule {}
