import { Injectable, Logger } from '@nestjs/common';
import { z } from 'zod';
import { loadConfig } from '../config.js';
import {
  CircuitBreaker,
  type OptionsResilience,
} from '@creche-planner/resilience';
import { appelResilient } from './appel-resilient.js';

/** Ligne de coût (débit/crédit) en centimes. */
const ligneVueSchema = z.object({
  libelle: z.string(),
  sens: z.enum(['debit', 'credit']),
  montantCentimes: z.number(),
});

/** Coût d'une prestation (un enfant, un mode) avec son détail de lignes. */
const coutPrestationVueSchema = z.object({
  enfant: z.string(),
  mode: z.string(),
  totalCentimes: z.number(),
  lignes: z.array(ligneVueSchema),
  // « Calculé avec » (SFD 30, US-30-04) : dates d'effet du tarif résolu et du contrat
  // ayant servi. Additifs/optionnels (`optional()`) — relayés tels quels au front.
  grilleValideDu: z.string().optional(),
  contratValideDu: z.string().optional(),
});

/** Coût d'un mois pour un foyer (agrégat des prestations). */
const coutMoisVueSchema = z.object({
  foyerId: z.string(),
  mois: z.string(),
  simule: z.boolean(),
  totalCentimes: z.number(),
  prestations: z.array(coutPrestationVueSchema),
  lignes: z.array(ligneVueSchema),
});

export type CoutMoisVue = z.infer<typeof coutMoisVueSchema>;

/** Coût annuel d'un foyer (agrégat des mois). */
const coutAnnuelVueSchema = z.object({
  foyerId: z.string(),
  annee: z.number(),
  simule: z.boolean(),
  totalCentimes: z.number(),
  mois: z.array(coutMoisVueSchema),
});

export type CoutAnnuelVue = z.infer<typeof coutAnnuelVueSchema>;

const OPTIONS: OptionsResilience = {
  timeoutMs: 2000,
  retries: 1,
  delaiEntreEssaisMs: 200,
};

/**
 * L'agrégation annuelle (`/api/couts/annuel`) est intrinsèquement plus lourde que
 * le coût d'un mois : même optimisée (12 mois calculés en parallèle côté service),
 * elle peut dépasser 2 s sous charge concurrente. On lui accorde un budget plus
 * large et **sans retry** — ré-essayer un GET coûteux qui vient d'expirer ne ferait
 * qu'aggraver la contention — pour éviter le repli 502 observé en validation E2E.
 */
const OPTIONS_ANNUEL: OptionsResilience = {
  timeoutMs: 8000,
  retries: 0,
  delaiEntreEssaisMs: 0,
};

/**
 * Client REST résilient vers `svc-tarification` (port 3005). Sur le chemin
 * critique du BFF : timeout + retry borné + circuit-breaker, avec
 * **propagation** des erreurs (`executerResilient`).
 *
 * `capturerCorpsErreur` est posé sur les deux lectures (`AM-69` : la capture est
 * opt-in par client) parce que le service émet désormais un **422 structuré**
 * `RESSOURCES_INCONNUES_AU_MOIS` — sans elle, `relayer` n'aurait que le statut, et
 * l'écran retomberait sur le message générique en perdant précisément la seule
 * information qui distingue « nous ne savons pas » d'une panne.
 */
@Injectable()
export class TarificationClient {
  private readonly logger = new Logger(TarificationClient.name);
  private readonly breaker = new CircuitBreaker();

  /** GET `/api/couts` — coût d'un (foyer, mois). */
  async cout(
    foyerId: string,
    mois: string,
    simule: boolean,
  ): Promise<CoutMoisVue> {
    const base = loadConfig().tarificationUrl;
    const url =
      `${base}/api/couts?foyer=${encodeURIComponent(foyerId)}` +
      `&mois=${encodeURIComponent(mois)}&simule=${simule ? 'true' : 'false'}`;
    return appelResilient({
      service: 'svc-tarification',
      logger: this.logger,
      breaker: this.breaker,
      options: OPTIONS,
      methode: 'GET',
      url,
      schema: coutMoisVueSchema,
      capturerCorpsErreur: true,
    });
  }

  /** GET `/api/couts/annuel` — coût annuel d'un foyer. */
  async coutAnnuel(
    foyerId: string,
    annee: number,
    simule: boolean,
  ): Promise<CoutAnnuelVue> {
    const base = loadConfig().tarificationUrl;
    const url =
      `${base}/api/couts/annuel?foyer=${encodeURIComponent(foyerId)}` +
      `&annee=${encodeURIComponent(String(annee))}&simule=${simule ? 'true' : 'false'}`;
    return appelResilient({
      service: 'svc-tarification',
      logger: this.logger,
      breaker: this.breaker,
      options: OPTIONS_ANNUEL,
      methode: 'GET',
      url,
      schema: coutAnnuelVueSchema,
      capturerCorpsErreur: true,
    });
  }
}
