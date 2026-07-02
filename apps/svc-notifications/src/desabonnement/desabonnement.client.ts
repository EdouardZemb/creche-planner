import { Injectable, Logger } from '@nestjs/common';
import { z } from 'zod';
import type { Canal, TypeNotification } from '@creche-planner/contracts-foyer';
import { loadConfig } from '../config.js';
import {
  CircuitBreaker,
  executerOuRepli,
  fetchAvecTimeout,
  type OptionsResilience,
} from '@creche-planner/resilience';

/** Réponse de `POST /api/desabonnement/jetons` : le jeton signé + son expiration. */
const jetonReponseSchema = z.object({
  token: z.string().min(1),
  expireLe: z.string(),
});

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

  /** Émet un jeton one-shot pour `(parent, type, canal)` ; `undefined` si indisponible. */
  async emettreJeton(demande: DemandeJeton): Promise<string | undefined> {
    const base = loadConfig().foyerUrl;
    const url = `${base}/api/desabonnement/jetons`;
    return executerOuRepli<string | undefined>(
      'svc-foyer',
      async () => {
        const reponse = await fetchAvecTimeout(url, OPTIONS.timeoutMs, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(demande),
        });
        if (!reponse.ok) {
          throw new Error(`HTTP ${reponse.status}`);
        }
        return jetonReponseSchema.parse(await reponse.json()).token;
      },
      undefined,
      this.breaker,
      OPTIONS,
      this.logger,
    );
  }
}
