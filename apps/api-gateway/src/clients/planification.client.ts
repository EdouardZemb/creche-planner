import { Injectable, Logger } from '@nestjs/common';
import { z } from 'zod';
import { loadConfig } from '../config.js';
import {
  CircuitBreaker,
  executerResilient,
  fetchAvecTimeout,
  type OptionsResilience,
} from './resilience.js';

/**
 * Saisie de création d'un contrat. Le corps est une union discriminée par
 * `mode` côté `svc-planification` (champs spécifiques : `semaineType`,
 * `semaineAbcm`, `heuresAnnuellesContractualisees`, `nbMensualites`…). On garde
 * un typage des champs communs et on laisse passer le reste via l'index
 * signature — la gateway relaie sans dupliquer le schéma complet du domaine.
 */
export interface SaisieContrat {
  readonly mode: 'CRECHE_PSU' | 'CANTINE' | 'PERISCOLAIRE' | 'ALSH';
  readonly foyerId: string;
  readonly enfant: string;
  readonly valideDu: string;
  readonly valideAu: string | null;
  readonly [k: string]: unknown;
}

/** Vue lecture d'un contrat renvoyée par `svc-planification`. */
const contratVueSchema = z.object({
  id: z.string(),
  foyerId: z.string(),
  enfant: z.string(),
  mode: z.string(),
  valideDu: z.string(),
  valideAu: z.string().nullable(),
});

export type ContratVue = z.infer<typeof contratVueSchema>;

/**
 * Réponse `GET /api/prestations` : prestations du mois (quantités, sans
 * montant). On valide a minima le `mode` et on conserve le reste
 * (`passthrough`).
 */
const prestationsReponseSchema = z.object({
  contratId: z.string(),
  mois: z.string(),
  simule: z.boolean(),
  prestations: z.array(
    z
      .object({
        mode: z.enum(['CRECHE_PSU', 'CANTINE', 'PERISCOLAIRE', 'ALSH']),
      })
      .passthrough(),
  ),
});

export type PrestationsReponse = z.infer<typeof prestationsReponseSchema>;

/** Corps d'écriture d'un planning, relayé tel quel vers le service amont. */
export type SaisiePlanning = Readonly<Record<string, unknown>>;

/**
 * Réponse `GET /api/contrats/:id/plannings/:mois` : la saisie enregistrée du
 * mois (forme libre, relayée telle quelle) ou `null` si aucune saisie.
 */
const lirePlanningReponseSchema = z.object({
  saisie: z.record(z.string(), z.unknown()).nullable(),
});

export type LirePlanningReponse = z.infer<typeof lirePlanningReponseSchema>;

const OPTIONS: OptionsResilience = {
  timeoutMs: 2000,
  retries: 1,
  delaiEntreEssaisMs: 200,
};

/**
 * Client REST résilient vers `svc-planification` (port 3004). Sur le chemin
 * critique du BFF : timeout + retry borné + circuit-breaker, avec
 * **propagation** des erreurs (`executerResilient`).
 */
@Injectable()
export class PlanificationClient {
  private readonly logger = new Logger(PlanificationClient.name);
  private readonly breaker = new CircuitBreaker();

  /** POST `/api/contrats` — crée un contrat. */
  async creerContrat(saisie: SaisieContrat): Promise<ContratVue> {
    const base = loadConfig().planificationUrl;
    const url = `${base}/api/contrats`;
    this.logger.debug(`POST ${url}`);
    return executerResilient(
      'svc-planification',
      async () => {
        const reponse = await fetchAvecTimeout(url, OPTIONS.timeoutMs, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(saisie),
        });
        if (!reponse.ok) {
          throw new Error('HTTP ' + reponse.status);
        }
        return contratVueSchema.parse(await reponse.json());
      },
      this.breaker,
      OPTIONS,
    );
  }

  /** GET `/api/contrats?foyer=` — liste les contrats d'un foyer (config incluse). */
  async listerContrats(foyerId: string): Promise<ContratVue[]> {
    const base = loadConfig().planificationUrl;
    const url = `${base}/api/contrats?foyer=${encodeURIComponent(foyerId)}`;
    this.logger.debug(`GET ${url}`);
    return executerResilient(
      'svc-planification',
      async () => {
        const reponse = await fetchAvecTimeout(url, OPTIONS.timeoutMs);
        if (!reponse.ok) {
          throw new Error('HTTP ' + reponse.status);
        }
        // `passthrough` : on conserve la config mode-spécifique (semaineType,
        // semaineAbcm, heures, nbMensualités) relayée telle quelle au front.
        return z
          .array(contratVueSchema.passthrough())
          .parse(await reponse.json());
      },
      this.breaker,
      OPTIONS,
    );
  }

  /** PUT `/api/contrats/:id` — modifie un contrat. */
  async modifierContrat(
    id: string,
    saisie: SaisieContrat,
  ): Promise<ContratVue> {
    const base = loadConfig().planificationUrl;
    const url = `${base}/api/contrats/${encodeURIComponent(id)}`;
    this.logger.debug(`PUT ${url}`);
    return executerResilient(
      'svc-planification',
      async () => {
        const reponse = await fetchAvecTimeout(url, OPTIONS.timeoutMs, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(saisie),
        });
        if (!reponse.ok) {
          throw new Error('HTTP ' + reponse.status);
        }
        return contratVueSchema.parse(await reponse.json());
      },
      this.breaker,
      OPTIONS,
    );
  }

  /** DELETE `/api/contrats/:id` — supprime un contrat (204 attendu). */
  async supprimerContrat(id: string): Promise<void> {
    const base = loadConfig().planificationUrl;
    const url = `${base}/api/contrats/${encodeURIComponent(id)}`;
    this.logger.debug(`DELETE ${url}`);
    await executerResilient(
      'svc-planification',
      async () => {
        const reponse = await fetchAvecTimeout(url, OPTIONS.timeoutMs, {
          method: 'DELETE',
        });
        if (!reponse.ok) {
          throw new Error('HTTP ' + reponse.status);
        }
      },
      this.breaker,
      OPTIONS,
    );
  }

  /** PUT `/api/contrats/:id/plannings/:mois` — écrit un planning (204 attendu). */
  async ecrirePlanning(
    contratId: string,
    mois: string,
    simule: boolean,
    corps: SaisiePlanning,
  ): Promise<void> {
    const base = loadConfig().planificationUrl;
    const url =
      `${base}/api/contrats/${encodeURIComponent(contratId)}` +
      `/plannings/${encodeURIComponent(mois)}?simule=${simule ? 'true' : 'false'}`;
    this.logger.debug(`PUT ${url}`);
    await executerResilient(
      'svc-planification',
      async () => {
        const reponse = await fetchAvecTimeout(url, OPTIONS.timeoutMs, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(corps),
        });
        if (!reponse.ok) {
          throw new Error('HTTP ' + reponse.status);
        }
      },
      this.breaker,
      OPTIONS,
    );
  }

  /** GET `/api/contrats/:id/plannings/:mois` — saisie enregistrée d'un mois. */
  async lirePlanning(
    contratId: string,
    mois: string,
    simule: boolean,
  ): Promise<LirePlanningReponse> {
    const base = loadConfig().planificationUrl;
    const url =
      `${base}/api/contrats/${encodeURIComponent(contratId)}` +
      `/plannings/${encodeURIComponent(mois)}?simule=${simule ? 'true' : 'false'}`;
    this.logger.debug(`GET ${url}`);
    return executerResilient(
      'svc-planification',
      async () => {
        const reponse = await fetchAvecTimeout(url, OPTIONS.timeoutMs);
        if (!reponse.ok) {
          throw new Error('HTTP ' + reponse.status);
        }
        return lirePlanningReponseSchema.parse(await reponse.json());
      },
      this.breaker,
      OPTIONS,
    );
  }

  /** GET `/api/prestations` — prestations générées d'un (contrat, mois). */
  async prestations(
    contratId: string,
    mois: string,
    simule: boolean,
  ): Promise<PrestationsReponse> {
    const base = loadConfig().planificationUrl;
    const url =
      `${base}/api/prestations?contrat=${encodeURIComponent(contratId)}` +
      `&mois=${encodeURIComponent(mois)}&simule=${simule ? 'true' : 'false'}`;
    this.logger.debug(`GET ${url}`);
    return executerResilient(
      'svc-planification',
      async () => {
        const reponse = await fetchAvecTimeout(url, OPTIONS.timeoutMs);
        if (!reponse.ok) {
          throw new Error('HTTP ' + reponse.status);
        }
        return prestationsReponseSchema.parse(await reponse.json());
      },
      this.breaker,
      OPTIONS,
    );
  }
}
