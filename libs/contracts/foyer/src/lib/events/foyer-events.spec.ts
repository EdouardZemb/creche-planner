import { describe, expect, it } from 'vitest';
import {
  ENFANT_AJOUTE_TYPE,
  ENFANT_MODIFIE_TYPE,
  ENFANT_RETIRE_TYPE,
  FOYER_EVENT_SOURCE,
  FOYER_MIS_A_JOUR_TYPE,
  FOYER_MIS_A_JOUR_V2_TYPE,
  PARENT_AJOUTE_TYPE,
  PARENT_MODIFIE_TYPE,
  PARENT_RETIRE_TYPE,
  enfantAjouteEventSchema,
  enfantModifieEventSchema,
  enfantRetireEventSchema,
  foyerMisAJourEventSchema,
  foyerMisAJourEventV2Schema,
  parentAjouteEventSchema,
  parentRetireEventSchema,
} from '../../index.js';

describe('contracts-foyer (événements foyer.*)', () => {
  it('valide un événement foyer.FoyerMisAJour.v1 bien formé', () => {
    const event = {
      id: '3f6b2c10-0000-4000-8000-000000000000',
      type: FOYER_MIS_A_JOUR_TYPE,
      source: FOYER_EVENT_SOURCE,
      version: 1,
      occurredAt: '2026-06-02T00:00:00.000Z',
      traceId: '0af7651916cd43dd8448eb211c80319c',
      payload: {
        foyerId: '11111111-0000-4000-8000-000000000000',
        ressourcesMensuellesCentimes: 671692,
        rfrCentimes: 7270500,
        nbEnfantsACharge: 2,
        nbParts: 3,
        tranche: 3,
      },
    };
    expect(foyerMisAJourEventSchema.safeParse(event).success).toBe(true);
  });

  it('rejette une tranche hors {1,2,3} dans FoyerMisAJour', () => {
    const result = foyerMisAJourEventSchema.safeParse({
      id: '3f6b2c10-0000-4000-8000-000000000000',
      type: FOYER_MIS_A_JOUR_TYPE,
      source: FOYER_EVENT_SOURCE,
      version: 1,
      occurredAt: '2026-06-02T00:00:00.000Z',
      traceId: 'x',
      payload: {
        foyerId: '11111111-0000-4000-8000-000000000000',
        ressourcesMensuellesCentimes: 0,
        rfrCentimes: 0,
        nbEnfantsACharge: 1,
        nbParts: 2,
        tranche: 4,
      },
    });
    expect(result.success).toBe(false);
  });

  // --- Versioning v1/v2 (DEC-02, ADR-0004 décision 2) -----------------------

  it('FOYER_MIS_A_JOUR_V2_TYPE expose bien le suffixe .v2', () => {
    expect(FOYER_MIS_A_JOUR_V2_TYPE).toBe('foyer.FoyerMisAJour.v2');
  });

  it('rétro-compat : un payload v1 historique reste accepté par le schéma v2', () => {
    const payloadV1Historique = {
      foyerId: '11111111-0000-4000-8000-000000000000',
      ressourcesMensuellesCentimes: 671692,
      rfrCentimes: 7270500,
      nbEnfantsACharge: 2,
      nbParts: 3,
      tranche: 3,
    };
    const eventV1 = {
      id: '3f6b2c10-0000-4000-8000-000000000000',
      type: FOYER_MIS_A_JOUR_TYPE,
      source: FOYER_EVENT_SOURCE,
      version: 1,
      occurredAt: '2026-06-02T00:00:00.000Z',
      traceId: '0af7651916cd43dd8448eb211c80319c',
      payload: payloadV1Historique,
    };
    // v1 reste valide pour son propre schéma…
    expect(foyerMisAJourEventSchema.safeParse(eventV1).success).toBe(true);
    // …et le schéma v2 accepte ce même payload v1 (champ optionnel absent).
    expect(foyerMisAJourEventV2Schema.safeParse(eventV1).success).toBe(true);
  });

  it('valide un événement foyer.FoyerMisAJour.v2 avec le champ optionnel anneeRevenus', () => {
    const eventV2 = {
      id: '3f6b2c10-0000-4000-8000-000000000000',
      type: FOYER_MIS_A_JOUR_V2_TYPE,
      source: FOYER_EVENT_SOURCE,
      version: 2,
      occurredAt: '2026-06-02T00:00:00.000Z',
      traceId: '0af7651916cd43dd8448eb211c80319c',
      payload: {
        foyerId: '11111111-0000-4000-8000-000000000000',
        ressourcesMensuellesCentimes: 671692,
        rfrCentimes: 7270500,
        nbEnfantsACharge: 2,
        nbParts: 3,
        tranche: 3,
        anneeRevenus: 2024,
      },
    };
    const result = foyerMisAJourEventV2Schema.safeParse(eventV2);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.payload.anneeRevenus).toBe(2024);
    }
  });

  it('rejette un anneeRevenus hors borne dans FoyerMisAJour.v2', () => {
    const result = foyerMisAJourEventV2Schema.safeParse({
      id: '3f6b2c10-0000-4000-8000-000000000000',
      type: FOYER_MIS_A_JOUR_V2_TYPE,
      source: FOYER_EVENT_SOURCE,
      version: 2,
      occurredAt: '2026-06-02T00:00:00.000Z',
      traceId: 'x',
      payload: {
        foyerId: '11111111-0000-4000-8000-000000000000',
        ressourcesMensuellesCentimes: 0,
        rfrCentimes: 0,
        nbEnfantsACharge: 1,
        nbParts: 2,
        tranche: 1,
        anneeRevenus: 1700,
      },
    });
    expect(result.success).toBe(false);
  });

  it('valide un événement foyer.EnfantAjoute.v1 bien formé', () => {
    const event = {
      id: '3f6b2c10-0000-4000-8000-000000000000',
      type: ENFANT_AJOUTE_TYPE,
      source: FOYER_EVENT_SOURCE,
      version: 1,
      occurredAt: '2026-06-02T00:00:00.000Z',
      traceId: 'x',
      payload: {
        foyerId: '11111111-0000-4000-8000-000000000000',
        enfantId: '22222222-0000-4000-8000-000000000000',
        prenom: 'Mia',
        dateNaissance: '2024-12-08',
      },
    };
    expect(enfantAjouteEventSchema.safeParse(event).success).toBe(true);
  });

  it('rejette une date de naissance mal formée dans EnfantAjoute', () => {
    const result = enfantAjouteEventSchema.safeParse({
      id: '3f6b2c10-0000-4000-8000-000000000000',
      type: ENFANT_AJOUTE_TYPE,
      source: FOYER_EVENT_SOURCE,
      version: 1,
      occurredAt: '2026-06-02T00:00:00.000Z',
      traceId: 'x',
      payload: {
        foyerId: '11111111-0000-4000-8000-000000000000',
        enfantId: '22222222-0000-4000-8000-000000000000',
        prenom: 'Mia',
        dateNaissance: '08/12/2024',
      },
    });
    expect(result.success).toBe(false);
  });

  // --- foyer.Enfant{Modifie,Retire}.v1 -------------------------------------

  it('expose les types versionnés des événements enfant (modif/retrait)', () => {
    expect(ENFANT_MODIFIE_TYPE).toBe('foyer.EnfantModifie.v1');
    expect(ENFANT_RETIRE_TYPE).toBe('foyer.EnfantRetire.v1');
  });

  it('valide un événement foyer.EnfantModifie.v1 (état complet, même forme qu’Ajoute)', () => {
    const event = {
      id: '3f6b2c10-0000-4000-8000-000000000000',
      type: ENFANT_MODIFIE_TYPE,
      source: FOYER_EVENT_SOURCE,
      version: 1,
      occurredAt: '2026-06-02T00:00:00.000Z',
      traceId: 'x',
      payload: {
        foyerId: '11111111-0000-4000-8000-000000000000',
        enfantId: '22222222-0000-4000-8000-000000000000',
        prenom: 'Mia',
        dateNaissance: '2024-12-08',
      },
    };
    expect(enfantModifieEventSchema.safeParse(event).success).toBe(true);
  });

  it('rejette une date de naissance mal formée dans EnfantModifie', () => {
    const result = enfantModifieEventSchema.safeParse({
      id: '3f6b2c10-0000-4000-8000-000000000000',
      type: ENFANT_MODIFIE_TYPE,
      source: FOYER_EVENT_SOURCE,
      version: 1,
      occurredAt: '2026-06-02T00:00:00.000Z',
      traceId: 'x',
      payload: {
        foyerId: '11111111-0000-4000-8000-000000000000',
        enfantId: '22222222-0000-4000-8000-000000000000',
        prenom: 'Mia',
        dateNaissance: '08/12/2024',
      },
    });
    expect(result.success).toBe(false);
  });

  it('EnfantRetire.v1 ne transporte que les identités (foyerId + enfantId)', () => {
    const event = {
      id: '3f6b2c10-0000-4000-8000-000000000000',
      type: ENFANT_RETIRE_TYPE,
      source: FOYER_EVENT_SOURCE,
      version: 1,
      occurredAt: '2026-06-02T00:00:00.000Z',
      traceId: 'x',
      payload: {
        foyerId: '11111111-0000-4000-8000-000000000000',
        enfantId: '22222222-0000-4000-8000-000000000000',
      },
    };
    expect(enfantRetireEventSchema.safeParse(event).success).toBe(true);
  });

  // --- foyer.Parent{Ajoute,Modifie,Retire}.v1 ------------------------------

  it('expose les types versionnés des événements parent', () => {
    expect(PARENT_AJOUTE_TYPE).toBe('foyer.ParentAjoute.v1');
    expect(PARENT_MODIFIE_TYPE).toBe('foyer.ParentModifie.v1');
    expect(PARENT_RETIRE_TYPE).toBe('foyer.ParentRetire.v1');
  });

  it('valide un événement foyer.ParentAjoute.v1 bien formé (prénom/nom optionnels)', () => {
    const event = {
      id: '3f6b2c10-0000-4000-8000-000000000000',
      type: PARENT_AJOUTE_TYPE,
      source: FOYER_EVENT_SOURCE,
      version: 1,
      occurredAt: '2026-06-02T00:00:00.000Z',
      traceId: 'x',
      payload: {
        foyerId: '11111111-0000-4000-8000-000000000000',
        parentId: '33333333-0000-4000-8000-000000000000',
        email: 'parent@example.com',
        principal: true,
        actif: true,
      },
    };
    expect(parentAjouteEventSchema.safeParse(event).success).toBe(true);
  });

  it('rejette un e-mail invalide dans ParentAjoute', () => {
    const result = parentAjouteEventSchema.safeParse({
      id: '3f6b2c10-0000-4000-8000-000000000000',
      type: PARENT_AJOUTE_TYPE,
      source: FOYER_EVENT_SOURCE,
      version: 1,
      occurredAt: '2026-06-02T00:00:00.000Z',
      traceId: 'x',
      payload: {
        foyerId: '11111111-0000-4000-8000-000000000000',
        parentId: '33333333-0000-4000-8000-000000000000',
        email: 'pas-un-email',
        principal: false,
        actif: true,
      },
    });
    expect(result.success).toBe(false);
  });

  it('ParentRetire.v1 ne transporte que les identités (foyerId + parentId)', () => {
    const event = {
      id: '3f6b2c10-0000-4000-8000-000000000000',
      type: PARENT_RETIRE_TYPE,
      source: FOYER_EVENT_SOURCE,
      version: 1,
      occurredAt: '2026-06-02T00:00:00.000Z',
      traceId: 'x',
      payload: {
        foyerId: '11111111-0000-4000-8000-000000000000',
        parentId: '33333333-0000-4000-8000-000000000000',
      },
    };
    expect(parentRetireEventSchema.safeParse(event).success).toBe(true);
  });
});
