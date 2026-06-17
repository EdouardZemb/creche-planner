import { describe, expect, it } from 'vitest';
import {
  CONTRAT_CREE_TYPE,
  PLANIFICATION_EVENT_SOURCE,
  PLANNING_MODIFIE_TYPE,
  contratCreeEventSchema,
  planningModifieEventSchema,
} from '../../index.js';

describe('contracts-planification (événements planification.*)', () => {
  it('valide un événement planification.ContratCree.v1 bien formé', () => {
    const event = {
      id: '3f6b2c10-0000-4000-8000-000000000000',
      type: CONTRAT_CREE_TYPE,
      source: PLANIFICATION_EVENT_SOURCE,
      version: 1,
      occurredAt: '2026-06-02T00:00:00.000Z',
      traceId: '0af7651916cd43dd8448eb211c80319c',
      payload: {
        contratId: '55555555-0000-4000-8000-000000000000',
        foyerId: '11111111-0000-4000-8000-000000000000',
        enfant: 'Mia',
        mode: 'CRECHE_PSU',
        valideDu: '2026-09-01',
        valideAu: null,
      },
    };
    expect(contratCreeEventSchema.safeParse(event).success).toBe(true);
  });

  it('rejette un mode inconnu dans ContratCree', () => {
    const result = contratCreeEventSchema.safeParse({
      id: '3f6b2c10-0000-4000-8000-000000000000',
      type: CONTRAT_CREE_TYPE,
      source: PLANIFICATION_EVENT_SOURCE,
      version: 1,
      occurredAt: '2026-06-02T00:00:00.000Z',
      traceId: 'x',
      payload: {
        contratId: '55555555-0000-4000-8000-000000000000',
        foyerId: '11111111-0000-4000-8000-000000000000',
        enfant: 'Mia',
        mode: 'GARDERIE',
        valideDu: '2026-09-01',
        valideAu: null,
      },
    });
    expect(result.success).toBe(false);
  });

  it('valide un événement planification.PlanningModifie.v1 bien formé', () => {
    const event = {
      id: '3f6b2c10-0000-4000-8000-000000000000',
      type: PLANNING_MODIFIE_TYPE,
      source: PLANIFICATION_EVENT_SOURCE,
      version: 1,
      occurredAt: '2026-06-02T00:00:00.000Z',
      traceId: '0af7651916cd43dd8448eb211c80319c',
      payload: {
        contratId: '55555555-0000-4000-8000-000000000000',
        mois: '2026-09',
        simule: true,
      },
    };
    expect(planningModifieEventSchema.safeParse(event).success).toBe(true);
  });

  it('rejette un mois mal formé dans PlanningModifie', () => {
    const result = planningModifieEventSchema.safeParse({
      id: '3f6b2c10-0000-4000-8000-000000000000',
      type: PLANNING_MODIFIE_TYPE,
      source: PLANIFICATION_EVENT_SOURCE,
      version: 1,
      occurredAt: '2026-06-02T00:00:00.000Z',
      traceId: 'x',
      payload: {
        contratId: '55555555-0000-4000-8000-000000000000',
        mois: '2026-09-01',
        simule: false,
      },
    });
    expect(result.success).toBe(false);
  });
});
