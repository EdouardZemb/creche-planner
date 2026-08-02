import { Injectable, Logger } from '@nestjs/common';
import { z } from 'zod';
import { entetesAssertionMachine } from '@creche-planner/nest-commons';
import { loadConfig } from '../config.js';
import {
  appelHttpOuRepli,
  CircuitBreaker,
  type OptionsResilience,
} from '@creche-planner/resilience';

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

/** Barème PSU applicable renvoyé par `svc-referentiel` (mode `CRECHE_PSU`, sans tranche). */
const baremePsuReponseSchema = z
  .object({
    mode: z.literal('CRECHE_PSU'),
    valideDu: z.string(),
    valideAu: z.string().nullable(),
    taux: z.record(z.string(), z.number()),
    plancherCentimes: z.number().nullable(),
    plafondCentimes: z.number().nullable(),
  })
  .passthrough();

/** Barème PSU applicable (taux + bornes CNAF) résolu à date. */
export type BaremePsuFallback = z.infer<typeof baremePsuReponseSchema>;

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

  /**
   * En-têtes sortants de ce service : l'**assertion machine HMAC**
   * inter-services (fondations lot 3), injectée dans la plomberie partagée. Elle
   * n'a rien à voir avec la propagation d'identité parent de la gateway — les
   * deux mécanismes restent distincts par construction.
   */
  private readonly entetes = (): Record<string, string> =>
    entetesAssertionMachine('svc-tarification', loadConfig().assertion.secret);

  async grilleApplicable(
    date: string,
    tranche: 1 | 2 | 3,
    mode: string,
  ): Promise<GrilleApplicableFallback | undefined> {
    const base = loadConfig().referentielUrl;
    const url =
      `${base}/api/grilles/applicable?date=${encodeURIComponent(date)}` +
      `&tranche=${tranche}&mode=${encodeURIComponent(mode)}`;
    return appelHttpOuRepli(
      {
        service: 'svc-referentiel',
        logger: this.logger,
        breaker: this.breaker,
        options: OPTIONS,
        entetes: this.entetes,
        methode: 'GET',
        url,
        schema: grilleReponseSchema,
      },
      undefined,
    );
  }

  /**
   * Barème PSU applicable à `date` (mode `CRECHE_PSU`, sans tranche) — repli
   * synchrone quand le read-model `bareme_psu` local est froid. Même résilience
   * (timeout / retry / circuit-breaker) ; `undefined` en cas d'échec total.
   */
  async baremePsuApplicable(
    date: string,
  ): Promise<BaremePsuFallback | undefined> {
    const base = loadConfig().referentielUrl;
    const url =
      `${base}/api/grilles/applicable?date=${encodeURIComponent(date)}` +
      `&mode=CRECHE_PSU`;
    return appelHttpOuRepli(
      {
        service: 'svc-referentiel',
        logger: this.logger,
        breaker: this.breaker,
        options: OPTIONS,
        entetes: this.entetes,
        methode: 'GET',
        url,
        schema: baremePsuReponseSchema,
      },
      undefined,
    );
  }
}
