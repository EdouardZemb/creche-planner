import { Injectable, Logger } from '@nestjs/common';
import { z } from 'zod';
import { entetesAssertionMachine } from '@creche-planner/nest-commons';
import type { Canal, TypeNotification } from '@creche-planner/contracts-foyer';
import { loadConfig } from '../config.js';
import {
  appelHttpOuRepli,
  CircuitBreaker,
  type OptionsResilience,
} from '@creche-planner/resilience';

/** Réponse de `POST /api/desabonnement/jetons` : le jeton signé + son expiration. */
const jetonReponseSchema = z
  .object({
    token: z.string().min(1),
    expireLe: z.string(),
  })
  // Le jeton seul intéresse l'appelant : le schéma déplie l'enveloppe pour que
  // la valeur nominale et la valeur de repli (`undefined`) aient le même type.
  .transform((reponse) => reponse.token);

const OPTIONS: OptionsResilience = {
  timeoutMs: 2000,
  retries: 1,
  delaiEntreEssaisMs: 200,
};

/** Demande d'émission d'un jeton, liée au triplet `(parent, type, canal)`. */
export interface DemandeJeton {
  readonly foyerId: string;
  readonly parentId: string;
  readonly typeNotification: TypeNotification;
  readonly canal: Canal;
}

/**
 * Client d'**émission des jetons de désabonnement** vers `svc-foyer` (agrégat
 * propriétaire du parent/token, §9.5). Même patron résilient que la relecture du
 * planning (`planification.client`) : timeout + retry borné + circuit-breaker. En
 * cas d'échec total, renvoie `undefined` (**dégradation propre**) : le récap part
 * alors **sans** en-tête `List-Unsubscribe` — on ne bloque jamais l'envoi d'une
 * notification de service parce que la frappe du jeton a échoué.
 */
@Injectable()
export class DesabonnementClient {
  private readonly logger = new Logger(DesabonnementClient.name);
  private readonly breaker = new CircuitBreaker();

  /**
   * Assertion machine inter-services (fondations lot 3). La route
   * `/api/desabonnement/jetons` (interne) N'EST PAS exemptée.
   */
  private readonly entetes = (): Record<string, string> =>
    entetesAssertionMachine('svc-notifications', loadConfig().assertion.secret);

  /** Émet un jeton one-shot pour `(parent, type, canal)` ; `undefined` si indisponible. */
  async emettreJeton(demande: DemandeJeton): Promise<string | undefined> {
    return appelHttpOuRepli(
      {
        service: 'svc-foyer',
        logger: this.logger,
        breaker: this.breaker,
        options: OPTIONS,
        entetes: this.entetes,
        methode: 'POST',
        url: `${loadConfig().foyerUrl}/api/desabonnement/jetons`,
        corps: demande,
        schema: jetonReponseSchema,
      },
      undefined,
    );
  }
}
