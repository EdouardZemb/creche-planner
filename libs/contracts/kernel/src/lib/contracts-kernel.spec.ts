import { describe, expect, it } from 'vitest';
import {
  healthCheckResultSchema,
  integrationEventEnvelopeSchema,
  integrationEventSchema,
} from '../index.js';
import { z } from 'zod';

describe('contracts-kernel (enveloppe + transverses)', () => {
  it('valide une enveloppe d’événement d’intégration bien formée', () => {
    const enveloppe = {
      id: '3f6b2c10-0000-4000-8000-000000000000',
      type: 'referentiel.GrillePubliee.v1',
      source: 'svc-referentiel',
      version: 1,
      occurredAt: '2026-09-01T00:00:00.000Z',
      traceId: '0af7651916cd43dd8448eb211c80319c',
    };
    expect(integrationEventEnvelopeSchema.safeParse(enveloppe).success).toBe(
      true,
    );
  });

  it('rejette une enveloppe sans traceId', () => {
    const { traceId, ...sansTrace } = {
      id: '3f6b2c10-0000-4000-8000-000000000000',
      type: 't',
      source: 's',
      version: 1,
      occurredAt: '2026-09-01T00:00:00.000Z',
      traceId: 'x',
    };
    void traceId;
    expect(integrationEventEnvelopeSchema.safeParse(sansTrace).success).toBe(
      false,
    );
  });

  it('greffe un payload typé sur l’enveloppe', () => {
    const schema = integrationEventSchema(z.object({ grilleId: z.string() }));
    const result = schema.safeParse({
      id: '3f6b2c10-0000-4000-8000-000000000000',
      type: 't',
      source: 's',
      version: 1,
      occurredAt: '2026-09-01T00:00:00.000Z',
      traceId: 'x',
      payload: { grilleId: 'g-1' },
    });
    expect(result.success).toBe(true);
  });

  it('valide une réponse /health', () => {
    const ok = {
      status: 'ok',
      details: { db: { status: 'up' }, nats: { status: 'up' } },
    };
    expect(healthCheckResultSchema.safeParse(ok).success).toBe(true);
  });
});
