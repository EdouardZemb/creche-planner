import { Injectable, Logger } from '@nestjs/common';
import { z } from 'zod';
import { entetesAssertionMachine } from '@creche-planner/nest-commons';
import { loadConfig } from '../config.js';
import {
  appelHttpOuRepli,
  CircuitBreaker,
  type OptionsResilience,
} from '@creche-planner/resilience';

/** Repli synchrone d'un foyer (forme exposée par `svc-foyer` `GET /api/foyers/:id`). */
const foyerReponseSchema = z.object({
  id: z.string().uuid(),
  ressourcesMensuellesCentimes: z.number().int().nonnegative(),
  rfrCentimes: z.number().int().nonnegative(),
  tranche: z.union([z.literal(1), z.literal(2), z.literal(3)]),
  nbParts: z.number().positive(),
  nbEnfantsACharge: z.number().int().min(1),
});

/** Données de foyer nécessaires à la valorisation (PSU + tranche ABCM). */
export interface FoyerFallback {
  readonly id: string;
  readonly ressourcesMensuellesCentimes: number;
  readonly rfrCentimes: number;
  readonly tranche: 1 | 2 | 3;
  readonly nbParts: number;
  readonly nbEnfantsACharge: number;
}

const OPTIONS: OptionsResilience = {
  timeoutMs: 2000,
  retries: 1,
  delaiEntreEssaisMs: 200,
};

/**
 * Client de **repli synchrone** vers `svc-foyer`. Utilisé quand le read model local
 * (projeté depuis le stream `FOYER`) est froid/incomplet pour le foyer demandé.
 * Timeout + retry borné + circuit-breaker (cf. `resilience.ts`). En cas d'échec
 * total, renvoie `undefined` (dégradation propre) : l'appelant décide alors quoi
 * faire (typiquement renvoyer un coût partiel/vide plutôt que planter).
 */
@Injectable()
export class FoyerClient {
  private readonly logger = new Logger(FoyerClient.name);
  private readonly breaker = new CircuitBreaker();

  /** Assertion machine HMAC inter-services (fondations lot 3), injectée dans l'appel. */
  private readonly entetes = (): Record<string, string> =>
    entetesAssertionMachine('svc-tarification', loadConfig().assertion.secret);

  async foyer(foyerId: string): Promise<FoyerFallback | undefined> {
    return appelHttpOuRepli(
      {
        service: 'svc-foyer',
        logger: this.logger,
        breaker: this.breaker,
        options: OPTIONS,
        entetes: this.entetes,
        methode: 'GET',
        url: `${loadConfig().foyerUrl}/api/foyers/${foyerId}`,
        schema: foyerReponseSchema,
      },
      undefined,
    );
  }
}
