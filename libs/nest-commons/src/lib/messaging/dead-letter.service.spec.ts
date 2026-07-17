import { describe, expect, it, vi } from 'vitest';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import type { OptionsConsumer } from './dead-letter.options.js';
import { DeadLetterService } from './dead-letter.service.js';

/**
 * `DeadLetterService` : insertion en base (table du service) et robustesse.
 * Le compteur OTel est un no-op sans MeterProvider (non observable ici) ; on
 * vérifie l'écriture, la troncature du payload et la non-propagation des erreurs.
 */

function fauxDb(values: ReturnType<typeof vi.fn>): {
  db: PostgresJsDatabase;
  insert: ReturnType<typeof vi.fn>;
} {
  const insert = vi.fn(() => ({ values }));
  const db = { insert } as unknown as PostgresJsDatabase;
  return { db, insert };
}

const OPTIONS: OptionsConsumer = {
  abonnements: [],
  tableDeadLetter: {
    nom: 'dead_letter',
  } as unknown as OptionsConsumer['tableDeadLetter'],
};

describe('DeadLetterService', () => {
  it('insère une ligne dead_letter avec les champs fournis', async () => {
    const values = vi.fn(() => Promise.resolve());
    const { db, insert } = fauxDb(values);
    const service = new DeadLetterService(db, OPTIONS);

    await service.enregistrer({
      envelopeId: 'env-1',
      stream: 'FOYER',
      sujet: 'foyer.EnfantModifie.v1',
      raison: 'TYPE_INCONNU',
      payload: '{"type":"x"}',
      erreur: null,
      livraisons: 3,
    });

    expect(insert).toHaveBeenCalledWith(OPTIONS.tableDeadLetter);
    expect(values).toHaveBeenCalledWith(
      expect.objectContaining({
        envelopeId: 'env-1',
        stream: 'FOYER',
        sujet: 'foyer.EnfantModifie.v1',
        raison: 'TYPE_INCONNU',
        payload: '{"type":"x"}',
        erreur: null,
        livraisons: 3,
      }),
    );
  });

  it('tronque le payload à 64 Ko', async () => {
    const values = vi.fn(() => Promise.resolve());
    const { db } = fauxDb(values);
    const service = new DeadLetterService(db, OPTIONS);

    await service.enregistrer({
      envelopeId: null,
      stream: 'FOYER',
      sujet: 's',
      raison: 'PARSE_KO',
      payload: 'x'.repeat(100_000),
      erreur: 'boom',
      livraisons: 1,
    });

    const [arg] = values.mock.calls[0] as unknown as [{ payload: string }];
    expect(arg.payload).toHaveLength(64 * 1024);
  });

  it('ne propage pas une erreur d’écriture (best effort)', async () => {
    const values = vi.fn(() => Promise.reject(new Error('db down')));
    const { db } = fauxDb(values);
    const service = new DeadLetterService(db, OPTIONS);

    await expect(
      service.enregistrer({
        envelopeId: null,
        stream: 'FOYER',
        sujet: 's',
        raison: 'PARSE_KO',
        payload: '{}',
        erreur: null,
        livraisons: 1,
      }),
    ).resolves.toBeUndefined();
  });
});
