import { describe, expect, it } from 'vitest';
import {
  NOTIFICATIONS_EVENT_SOURCE,
  SEMAINE_VALIDEE_TYPE,
  semaineValideeEventSchema,
  semaineValideePayloadSchema,
} from '../../index.js';

const ENVELOPPE = {
  id: '3f6b2c10-0000-4000-8000-000000000000',
  type: SEMAINE_VALIDEE_TYPE,
  source: NOTIFICATIONS_EVENT_SOURCE,
  version: 1,
  occurredAt: '2026-07-05T08:00:00.000Z',
  traceId: '0af7651916cd43dd8448eb211c80319c',
};

const CONTRAT_ID = '55555555-0000-4000-8000-000000000000';

describe('contracts-notifications (événements notifications.*)', () => {
  it('valide un événement notifications.SemaineValidee.v1 sans modifs (VALIDEE)', () => {
    const event = {
      ...ENVELOPPE,
      payload: {
        contratId: CONTRAT_ID,
        semaineIso: '2026-W27',
        statut: 'VALIDEE',
      },
    };
    expect(semaineValideeEventSchema.safeParse(event).success).toBe(true);
  });

  it('valide un événement VALIDEE_AVEC_MODIFS transportant le deltaModifs', () => {
    const event = {
      ...ENVELOPPE,
      payload: {
        contratId: CONTRAT_ID,
        semaineIso: '2026-W27',
        statut: 'VALIDEE_AVEC_MODIFS',
        deltaModifs: {
          jours: [
            {
              date: '2026-07-01',
              avant: null,
              apres: { joursSupplementaires: [{ date: '2026-07-01' }] },
            },
          ],
        },
      },
    };
    expect(semaineValideeEventSchema.safeParse(event).success).toBe(true);
  });

  it('rejette un statut hors {VALIDEE, VALIDEE_AVEC_MODIFS} (A_VALIDER interdit)', () => {
    const result = semaineValideePayloadSchema.safeParse({
      contratId: CONTRAT_ID,
      semaineIso: '2026-W27',
      statut: 'A_VALIDER',
    });
    expect(result.success).toBe(false);
  });

  it('rejette une semaine ISO malformée', () => {
    const result = semaineValideePayloadSchema.safeParse({
      contratId: CONTRAT_ID,
      semaineIso: '2026-06-29',
      statut: 'VALIDEE',
    });
    expect(result.success).toBe(false);
  });

  it('rejette une date de jour modifié malformée dans le delta', () => {
    const result = semaineValideePayloadSchema.safeParse({
      contratId: CONTRAT_ID,
      semaineIso: '2026-W27',
      statut: 'VALIDEE_AVEC_MODIFS',
      deltaModifs: { jours: [{ date: 'demain', avant: null, apres: null }] },
    });
    expect(result.success).toBe(false);
  });
});
