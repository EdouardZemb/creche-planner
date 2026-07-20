import { describe, expect, it } from 'vitest';
import {
  BAREME_PSU_PUBLIE_TYPE,
  GRILLE_PUBLIEE_TYPE,
  GRILLE_PUBLIEE_V2_TYPE,
  REFERENTIEL_EVENT_SOURCE,
  baremePsuPublieEventSchema,
  grillePublieeEventSchema,
  grillePublieeV2EventSchema,
} from '../../index.js';

describe('contracts-referentiel (événements referentiel.*)', () => {
  it('valide un événement referentiel.GrillePubliee.v1 bien formé', () => {
    const event = {
      id: '3f6b2c10-0000-4000-8000-000000000000',
      type: GRILLE_PUBLIEE_TYPE,
      source: REFERENTIEL_EVENT_SOURCE,
      version: 1,
      occurredAt: '2026-01-01T00:00:00.000Z',
      traceId: '0af7651916cd43dd8448eb211c80319c',
      payload: {
        grilleId: '44444444-0000-4000-8000-000000000000',
        mode: 'CANTINE',
        tranche: 3,
        valideDu: '2026-01-01',
        valideAu: null,
      },
    };
    expect(grillePublieeEventSchema.safeParse(event).success).toBe(true);
  });

  it('rejette un mode hors ABCM dans GrillePubliee', () => {
    const result = grillePublieeEventSchema.safeParse({
      id: '3f6b2c10-0000-4000-8000-000000000000',
      type: GRILLE_PUBLIEE_TYPE,
      source: REFERENTIEL_EVENT_SOURCE,
      version: 1,
      occurredAt: '2026-01-01T00:00:00.000Z',
      traceId: 'x',
      payload: {
        grilleId: '44444444-0000-4000-8000-000000000000',
        mode: 'CRECHE_PSU',
        tranche: 3,
        valideDu: '2026-01-01',
        valideAu: null,
      },
    });
    expect(result.success).toBe(false);
  });

  it('valide un referentiel.GrillePubliee.v2 avec paramètres (montants centimes)', () => {
    const event = {
      id: '3f6b2c10-0000-4000-8000-000000000000',
      type: GRILLE_PUBLIEE_V2_TYPE,
      source: REFERENTIEL_EVENT_SOURCE,
      version: 1,
      occurredAt: '2026-01-01T00:00:00.000Z',
      traceId: '0af7651916cd43dd8448eb211c80319c',
      payload: {
        grilleId: '44444444-0000-4000-8000-000000000000',
        mode: 'CANTINE',
        tranche: 3,
        valideDu: '2026-01-01',
        valideAu: null,
        parametres: {
          cantineTotalCentimes: 1268,
          cantinePartGardeCentimes: 801,
        },
      },
    };
    expect(grillePublieeV2EventSchema.safeParse(event).success).toBe(true);
  });

  it('valide un referentiel.BaremePsuPublie.v1 (taux + bornes)', () => {
    const event = {
      id: '3f6b2c10-0000-4000-8000-000000000000',
      type: BAREME_PSU_PUBLIE_TYPE,
      source: REFERENTIEL_EVENT_SOURCE,
      version: 1,
      occurredAt: '2026-01-01T00:00:00.000Z',
      traceId: '0af7651916cd43dd8448eb211c80319c',
      payload: {
        baremeId: '55555555-0000-4000-8000-000000000000',
        valideDu: '2026-01-01',
        valideAu: null,
        taux: { '1': 0.000619, '2': 0.000516 },
        plancherCentimes: null,
        plafondCentimes: null,
      },
    };
    expect(baremePsuPublieEventSchema.safeParse(event).success).toBe(true);
  });
});
