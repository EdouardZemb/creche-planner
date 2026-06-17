import { Inject, Injectable } from '@nestjs/common';
import {
  HealthIndicatorService,
  type HealthIndicatorResult,
} from '@nestjs/terminus';
import type { Sql } from 'postgres';
import { PG_CLIENT } from '../database/database.options.js';

/** Sonde readiness de la base PostgreSQL dédiée (un simple `SELECT 1`). */
@Injectable()
export class DatabaseHealthIndicator {
  constructor(
    @Inject(PG_CLIENT) private readonly sql: Sql,
    private readonly health: HealthIndicatorService,
  ) {}

  async isHealthy(key: string): Promise<HealthIndicatorResult> {
    const indicator = this.health.check(key);
    try {
      await this.sql`select 1`;
      return indicator.up();
    } catch (erreur) {
      return indicator.down({ message: (erreur as Error).message });
    }
  }
}
