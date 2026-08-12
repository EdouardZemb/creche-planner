import { describe, expect, it } from 'vitest';
import type { DynamicModule, FactoryProvider } from '@nestjs/common';
import { DRIZZLE } from '../database/database.options.js';
import { OPTIONS_PURGE, type TachePurge } from './purge.options.js';
import { PurgeModule } from './purge.module.js';

/**
 * `forRoot` n'est pas du pur câblage : sa fabrique **résout** les tâches propres au
 * service en leur passant la base. Si elle oubliait de les appeler, toutes les bornes
 * d'un service disparaîtraient sans qu'aucune autre porte ne le voie — le module
 * démarrerait, le balayage tournerait, et il ne borderait rien.
 */

/** Forme résolue par la fabrique (les tables restent opaques à ce niveau). */
interface OptionsResolues {
  readonly outbox: unknown;
  readonly deadLetter: unknown;
  readonly taches: readonly TachePurge[];
}

function fabriqueOptions(
  module: DynamicModule,
): FactoryProvider<OptionsResolues> {
  const provider = (module.providers ?? []).find(
    (p): p is FactoryProvider<OptionsResolues> =>
      typeof p === 'object' && 'provide' in p && p.provide === OPTIONS_PURGE,
  );
  if (!provider) {
    throw new Error('fournisseur OPTIONS_PURGE absent');
  }
  return provider;
}

/** Exécute la fabrique et rend les options résolues (`useFactory` peut être async). */
async function resoudre(
  module: DynamicModule,
  base: unknown,
): Promise<OptionsResolues> {
  return await fabriqueOptions(module).useFactory(base);
}

/** Table conforme au modèle structurel partagé, réduite à ses noms de colonnes. */
const TABLE_OUTBOX = {
  id: {},
  type: {},
  payload: {},
  occurredAt: {},
  traceId: {},
  publishedAt: {},
};

const TACHE: TachePurge = {
  nom: 'notification',
  retentionJours: 365,
  executer: () => Promise.resolve(0),
};

describe('PurgeModule.forRoot', () => {
  it('injecte la base du service dans la fabrique des tâches', async () => {
    const bases: unknown[] = [];
    const module = PurgeModule.forRoot({
      outbox: null,
      deadLetter: null,
      taches: (db) => {
        bases.push(db);
        return [TACHE];
      },
    });
    expect(fabriqueOptions(module).inject).toEqual([DRIZZLE]);

    const base = { marqueur: 'base du service' };
    expect((await resoudre(module, base)).taches).toEqual([TACHE]);
    expect(bases).toEqual([base]);
  });

  it('relaie les tables techniques telles quelles, y compris leur absence', async () => {
    const options = await resoudre(
      PurgeModule.forRoot({ outbox: TABLE_OUTBOX, deadLetter: null }),
      {},
    );
    expect(options.outbox).toBe(TABLE_OUTBOX);
    expect(options.deadLetter).toBeNull();
  });

  it('accepte un service sans tâche propre', async () => {
    const options = await resoudre(
      PurgeModule.forRoot({ outbox: null, deadLetter: null }),
      {},
    );
    expect(options.taches).toEqual([]);
  });
});
