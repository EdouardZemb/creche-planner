import { Injectable, Logger } from '@nestjs/common';
import { z } from 'zod';
import { loadConfig } from '../config.js';
import {
  CircuitBreaker,
  executerOuRepli,
  fetchAvecTimeout,
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

  async foyer(foyerId: string): Promise<FoyerFallback | undefined> {
    const url = `${loadConfig().foyerUrl}/api/foyers/${foyerId}`;
    return executerOuRepli<FoyerFallback | undefined>(
      'svc-foyer',
      async () => {
        const reponse = await fetchAvecTimeout(url, OPTIONS.timeoutMs);
        if (!reponse.ok) {
          throw new Error(`HTTP ${reponse.status}`);
        }
        return foyerReponseSchema.parse(await reponse.json());
      },
      undefined,
      this.breaker,
      OPTIONS,
      this.logger,
    );
  }
}
