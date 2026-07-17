import { Injectable, Logger } from '@nestjs/common';
import { z } from 'zod';
import { loadConfig } from '../config.js';
import {
  CircuitBreaker,
  executerResilient,
  fetchAvecTimeout,
  type OptionsResilience,
} from '@creche-planner/resilience';
import { entetesAval } from './assertion-aval.js';

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
    this.logger.debug(`GET ${url}`);
    return executerResilient(
      'svc-tarification',
      async () => {
        const reponse = await fetchAvecTimeout(url, OPTIONS.timeoutMs, {
          headers: entetesAval(),
        });
        if (!reponse.ok) {
          throw new Error('HTTP ' + reponse.status);
        }
        return coutMoisVueSchema.parse(await reponse.json());
      },
      this.breaker,
      OPTIONS,
    );
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
    this.logger.debug(`GET ${url}`);
    return executerResilient(
      'svc-tarification',
      async () => {
        const reponse = await fetchAvecTimeout(url, OPTIONS_ANNUEL.timeoutMs, {
          headers: entetesAval(),
        });
        if (!reponse.ok) {
          throw new Error('HTTP ' + reponse.status);
        }
        return coutAnnuelVueSchema.parse(await reponse.json());
      },
      this.breaker,
      OPTIONS_ANNUEL,
    );
  }
}
