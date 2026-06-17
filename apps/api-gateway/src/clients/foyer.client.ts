import { Injectable, Logger } from '@nestjs/common';
import { z } from 'zod';
import { loadConfig } from '../config.js';
import {
  CircuitBreaker,
  executerResilient,
  fetchAvecTimeout,
  type OptionsResilience,
} from './resilience.js';

/** Saisie de création d'un foyer (montants en euros saisis par l'usager). */
export interface SaisieFoyer {
  readonly ressourcesMensuelles: number;
  readonly rfr: number;
  readonly nbEnfantsACharge: number;
  readonly nbParts: number;
}

/** Saisie de rattachement d'un enfant à un foyer. */
export interface SaisieEnfant {
  readonly prenom: string;
  readonly dateNaissance: string;
}

/** Vue lecture d'un foyer renvoyée par `svc-foyer` (centimes = entiers). */
const foyerVueSchema = z.object({
  id: z.string(),
  ressourcesMensuellesCentimes: z.number(),
  ressourcesMensuellesEuros: z.number(),
  rfrCentimes: z.number(),
  rfrEuros: z.number(),
  nbEnfantsACharge: z.number(),
  nbParts: z.number(),
  tranche: z.number(),
});

export type FoyerVue = z.infer<typeof foyerVueSchema>;

/** Vue lecture d'un enfant rattaché à un foyer. */
const enfantVueSchema = z.object({
  id: z.string(),
  foyerId: z.string(),
  prenom: z.string(),
  dateNaissance: z.string(),
});

export type EnfantVue = z.infer<typeof enfantVueSchema>;

const OPTIONS: OptionsResilience = {
  timeoutMs: 2000,
  retries: 1,
  delaiEntreEssaisMs: 200,
};

/**
 * Client REST résilient vers `svc-foyer` (port 3002). Sur le chemin critique
 * du BFF : timeout + retry borné + circuit-breaker, mais **propagation** des
 * erreurs (`executerResilient`) afin que le contrôleur remonte un code propre.
 */
@Injectable()
export class FoyerClient {
  private readonly logger = new Logger(FoyerClient.name);
  private readonly breaker = new CircuitBreaker();

  /** POST `/api/foyers` — crée un foyer. */
  async creerFoyer(saisie: SaisieFoyer): Promise<FoyerVue> {
    const base = loadConfig().foyerUrl;
    const url = `${base}/api/foyers`;
    this.logger.debug(`POST ${url}`);
    return executerResilient(
      'svc-foyer',
      async () => {
        const reponse = await fetchAvecTimeout(url, OPTIONS.timeoutMs, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(saisie),
        });
        if (!reponse.ok) {
          throw new Error('HTTP ' + reponse.status);
        }
        return foyerVueSchema.parse(await reponse.json());
      },
      this.breaker,
      OPTIONS,
    );
  }

  /** POST `/api/foyers/:id/enfants` — rattache un enfant. */
  async ajouterEnfant(
    foyerId: string,
    saisie: SaisieEnfant,
  ): Promise<EnfantVue> {
    const base = loadConfig().foyerUrl;
    const url = `${base}/api/foyers/${encodeURIComponent(foyerId)}/enfants`;
    this.logger.debug(`POST ${url}`);
    return executerResilient(
      'svc-foyer',
      async () => {
        const reponse = await fetchAvecTimeout(url, OPTIONS.timeoutMs, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(saisie),
        });
        if (!reponse.ok) {
          throw new Error('HTTP ' + reponse.status);
        }
        return enfantVueSchema.parse(await reponse.json());
      },
      this.breaker,
      OPTIONS,
    );
  }

  /** GET `/api/foyers` — liste les foyers existants. */
  async lister(): Promise<FoyerVue[]> {
    const base = loadConfig().foyerUrl;
    const url = `${base}/api/foyers`;
    this.logger.debug(`GET ${url}`);
    return executerResilient(
      'svc-foyer',
      async () => {
        const reponse = await fetchAvecTimeout(url, OPTIONS.timeoutMs);
        if (!reponse.ok) {
          throw new Error('HTTP ' + reponse.status);
        }
        return z.array(foyerVueSchema).parse(await reponse.json());
      },
      this.breaker,
      OPTIONS,
    );
  }

  /** GET `/api/foyers/:id` — lit un foyer. */
  async foyer(foyerId: string): Promise<FoyerVue> {
    const base = loadConfig().foyerUrl;
    const url = `${base}/api/foyers/${encodeURIComponent(foyerId)}`;
    this.logger.debug(`GET ${url}`);
    return executerResilient(
      'svc-foyer',
      async () => {
        const reponse = await fetchAvecTimeout(url, OPTIONS.timeoutMs);
        if (!reponse.ok) {
          throw new Error('HTTP ' + reponse.status);
        }
        return foyerVueSchema.parse(await reponse.json());
      },
      this.breaker,
      OPTIONS,
    );
  }

  /** GET `/api/foyers/:id/enfants` — liste les enfants du foyer. */
  async enfants(foyerId: string): Promise<EnfantVue[]> {
    const base = loadConfig().foyerUrl;
    const url = `${base}/api/foyers/${encodeURIComponent(foyerId)}/enfants`;
    this.logger.debug(`GET ${url}`);
    return executerResilient(
      'svc-foyer',
      async () => {
        const reponse = await fetchAvecTimeout(url, OPTIONS.timeoutMs);
        if (!reponse.ok) {
          throw new Error('HTTP ' + reponse.status);
        }
        return z.array(enfantVueSchema).parse(await reponse.json());
      },
      this.breaker,
      OPTIONS,
    );
  }
}
