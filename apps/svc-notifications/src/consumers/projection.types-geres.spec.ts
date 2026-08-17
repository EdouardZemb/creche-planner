import { describe, expect, it } from 'vitest';
import { sujetsDuStream } from '@creche-planner/nest-commons';
import { TYPES_EVENEMENTS_FOYER } from '@creche-planner/contracts-foyer';
import { TYPES_EVENEMENTS_PLANIFICATION } from '@creche-planner/contracts-planification';
import { ABONNEMENTS } from './consumers.module.js';
import { ProjectionService } from './projection.service.js';
import type { Database } from '../database/database.types.js';

/**
 * `AM-53` — `typesGeres` est la **source** du `filter_subjects` des durables : ce
 * que la projection ne déclare pas ne lui est plus livré, donc n'écrit plus son
 * payload en clair dans `dead_letter`. Une liste fausse est donc coûteuse dans les
 * deux sens, et les deux sens sont ici prouvés en **exécutant** la projection sur
 * l'inventaire complet de ses streams amont — jamais en relisant son `switch` :
 *
 * - un type déclaré mais sans branche serait livré pour rien (rebut à chaque
 *   message, avec le payload que le lot retire) ;
 * - un type **non** déclaré mais traité serait filtré, donc **jamais projeté** —
 *   la panne silencieuse, celle qu'aucun rebut ne signale.
 */

/** Inventaire des types publiés sur les streams auxquels ce service s'abonne. */
const INVENTAIRE: readonly string[] = [
  ...TYPES_EVENEMENTS_FOYER,
  ...TYPES_EVENEMENTS_PLANIFICATION,
];

/**
 * Base muette : tout appel lève. Seul compte le chemin **avant** la première
 * écriture — un type géré part alors en `ECHEC_TRANSITOIRE`, ce qui n'est pas
 * `IGNORE_TYPE_INCONNU` et suffit à distinguer « branche présente » de « default ».
 */
const dbMuette = {} as unknown as Database;

/** Stream d'un type : son premier segment, comme en production. */
function streamDe(type: string): string {
  return (type.split('.')[0] ?? '').toUpperCase();
}

function enveloppe(type: string): unknown {
  return {
    id: '11111111-1111-4111-8111-111111111111',
    type,
    source: 'sonde',
    version: 1,
    occurredAt: '2026-01-01T00:00:00.000Z',
    traceId: 'sonde',
    payload: {},
  };
}

describe('svc-notifications — typesGeres borne les abonnements (AM-53)', () => {
  const projection = new ProjectionService(dbMuette);

  it('chaque abonnement porte au moins un sujet géré', () => {
    for (const { stream, durable } of ABONNEMENTS) {
      const sujets = sujetsDuStream(projection.typesGeres, stream);
      expect(sujets.length, `${durable}@${stream}`).toBeGreaterThan(0);
    }
  });

  it("l'inventaire des contrats couvre chaque stream abonné", () => {
    for (const { stream } of ABONNEMENTS) {
      expect(sujetsDuStream(INVENTAIRE, stream).length, stream).toBeGreaterThan(
        0,
      );
    }
  });

  it('aucun type déclaré ne sort de cet inventaire', () => {
    const horsInventaire = projection.typesGeres.filter(
      (type) => !INVENTAIRE.includes(type),
    );
    expect(horsInventaire).toEqual([]);
  });

  it('tout type déclaré a bien une branche (sinon il serait livré pour rien)', async () => {
    for (const type of projection.typesGeres) {
      await expect(
        projection.traiter(streamDe(type), enveloppe(type)),
        type,
      ).resolves.not.toBe('IGNORE_TYPE_INCONNU');
    }
  });

  it('aucun type non déclaré n’a de branche (sinon il serait filtré, donc jamais projeté)', async () => {
    const nonDeclares = INVENTAIRE.filter(
      (type) => !projection.typesGeres.includes(type),
    );
    for (const type of nonDeclares) {
      await expect(
        projection.traiter(streamDe(type), enveloppe(type)),
        type,
      ).resolves.toBe('IGNORE_TYPE_INCONNU');
    }
  });
});
