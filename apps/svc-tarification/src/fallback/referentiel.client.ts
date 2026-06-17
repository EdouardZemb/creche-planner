import { Injectable, Logger } from '@nestjs/common';
import { z } from 'zod';
import { loadConfig } from '../config.js';
import {
  CircuitBreaker,
  executerOuRepli,
  fetchAvecTimeout,
  type OptionsResilience,
} from './resilience.js';

/** Grille ABCM applicable renvoyée par `svc-referentiel` (`GET /api/grilles/applicable`). */
const grilleReponseSchema = z
  .object({
    mode: z.string(),
    tranche: z.union([z.literal(1), z.literal(2), z.literal(3)]).nullable(),
    valideDu: z.string(),
    valideAu: z.string().nullable(),
  })
  .passthrough();

/** Forme générique d'une grille/barème applicable (paramètres bruts conservés). */
export type GrilleApplicableFallback = z.infer<typeof grilleReponseSchema>;

const OPTIONS: OptionsResilience = {
  timeoutMs: 2000,
  retries: 1,
  delaiEntreEssaisMs: 200,
};

/**
 * Client de **repli synchrone** vers `svc-referentiel`. Permet de confirmer qu'une
 * grille/barème est applicable à (date, tranche, mode) quand le read model local
 * (stream `REFERENTIEL`) est froid. Le **calcul** des montants reste porté par le
 * domaine `@creche-planner/tarification-domain` (grilles 2026 figées, alignées sur
 * le catalogue du Référentiel) ; ce client sert la fraîcheur/diagnostic et la
 * résilience, pas la formule. Timeout + retry borné + circuit-breaker ; renvoie
 * `undefined` en cas d'échec total (dégradation propre).
 */
@Injectable()
export class ReferentielClient {
  private readonly logger = new Logger(ReferentielClient.name);
  private readonly breaker = new CircuitBreaker();

  async grilleApplicable(
    date: string,
    tranche: 1 | 2 | 3,
    mode: string,
  ): Promise<GrilleApplicableFallback | undefined> {
    const base = loadConfig().referentielUrl;
    const url =
      `${base}/api/grilles/applicable?date=${encodeURIComponent(date)}` +
      `&tranche=${tranche}&mode=${encodeURIComponent(mode)}`;
    return executerOuRepli<GrilleApplicableFallback | undefined>(
      'svc-referentiel',
      async () => {
        const reponse = await fetchAvecTimeout(url, OPTIONS.timeoutMs);
        if (!reponse.ok) {
          throw new Error(`HTTP ${reponse.status}`);
        }
        return grilleReponseSchema.parse(await reponse.json());
      },
      undefined,
      this.breaker,
      OPTIONS,
      this.logger,
    );
  }
}
