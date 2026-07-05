import { Injectable, Logger } from '@nestjs/common';
import { z } from 'zod';
import { loadConfig } from '../config.js';
import {
  CircuitBreaker,
  executerResilient,
  fetchAvecTimeout,
  type OptionsResilience,
} from '@creche-planner/resilience';

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
  /** Lien de référence vers l'enfant (agrégat `svc-foyer`). */
  readonly enfantId: string;
  readonly valideDu: string;
  readonly valideAu: string | null;
  readonly [k: string]: unknown;
}

/** Vue lecture d'un contrat renvoyée par `svc-planification`. */
const contratVueSchema = z.object({
  id: z.string(),
  foyerId: z.string(),
  enfant: z.string(),
  /**
   * Lien de référence vers l'enfant (`svc-foyer`), `null` pour un contrat
   * historique pas encore rapproché (back-fill en attente).
   */
  enfantId: z.string().nullable(),
  mode: z.string(),
  /**
   * Établissement réel rattaché (lien explicite P2/P3), `null`/absent si aucun.
   * Porté par la liste des contrats (`listerContrats`) — clé de routage du récap
   * hebdo par le BFF `semaine-besoins`. Optionnel : le cœur de contrat
   * (`creerContrat`/`contrat`) ne l'expose pas, on tolère donc son absence.
   */
  etablissementId: z.string().nullish(),
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

/** Règle de préavis d'un établissement (union discriminée par `type`). */
const preavisRegleSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('JOURS_OUVRES'), valeur: z.number() }),
  z.object({
    type: z.literal('JOUR_HEURE'),
    jour: z.string(),
    heure: z.string(),
  }),
]);

/**
 * Vue lecture d'un **établissement** (entité libre par foyer, P2) renvoyée par
 * `svc-planification`. Distincte de l'`EtablissementVue` à clés de l'ancien
 * annuaire `svc-notifications` (`notifications.client.ts`) — les deux coexistent
 * jusqu'au démantèlement P6.
 */
const etablissementVueSchema = z.object({
  id: z.string(),
  foyerId: z.string(),
  nom: z.string(),
  emailService: z.string().nullable(),
  preavisRegle: preavisRegleSchema.nullable(),
  types: z.array(z.string()),
  adresse: z.string().nullable(),
  telephone: z.string().nullable(),
  contact: z.string().nullable(),
  actif: z.boolean(),
});

export type EtablissementVue = z.infer<typeof etablissementVueSchema>;

/** Corps de création/édition d'un établissement, relayé tel quel (validé en amont). */
export type SaisieEtablissement = Readonly<Record<string, unknown>>;

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

  /**
   * GET `/api/contrats/:id` — cœur d'un contrat (dont son `foyerId`). Sert la
   * **résolution contrat → foyer** du guard d'appartenance (PR7) : les routes
   * `/contrats/:id/...` ne portent qu'un `contratId`. 404 → erreur propagée.
   */
  async contrat(id: string): Promise<ContratVue> {
    const base = loadConfig().planificationUrl;
    const url = `${base}/api/contrats/${encodeURIComponent(id)}`;
    this.logger.debug(`GET ${url}`);
    return executerResilient(
      'svc-planification',
      async () => {
        const reponse = await fetchAvecTimeout(url, OPTIONS.timeoutMs);
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

  /**
   * PUT `/api/contrats/:id/plannings/semaine/:semaineIso` — édite les besoins
   * d'une seule semaine (fusion read-modify-write côté service ; 204 attendu).
   */
  async ecrireSemaine(
    contratId: string,
    semaineIso: string,
    simule: boolean,
    corps: SaisiePlanning,
  ): Promise<void> {
    const base = loadConfig().planificationUrl;
    const url =
      `${base}/api/contrats/${encodeURIComponent(contratId)}` +
      `/plannings/semaine/${encodeURIComponent(semaineIso)}?simule=${simule ? 'true' : 'false'}`;
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

  /** GET `/api/etablissements?foyer=` — établissements (entité libre) d'un foyer. */
  async listerEtablissements(foyerId: string): Promise<EtablissementVue[]> {
    const base = loadConfig().planificationUrl;
    const url = `${base}/api/etablissements?foyer=${encodeURIComponent(foyerId)}`;
    this.logger.debug(`GET ${url}`);
    return executerResilient(
      'svc-planification',
      async () => {
        const reponse = await fetchAvecTimeout(url, OPTIONS.timeoutMs);
        if (!reponse.ok) {
          throw new Error('HTTP ' + reponse.status);
        }
        return z.array(etablissementVueSchema).parse(await reponse.json());
      },
      this.breaker,
      OPTIONS,
    );
  }

  /** POST `/api/etablissements?foyer=` — crée un établissement (201). */
  async creerEtablissement(
    foyerId: string,
    saisie: SaisieEtablissement,
  ): Promise<EtablissementVue> {
    const base = loadConfig().planificationUrl;
    const url = `${base}/api/etablissements?foyer=${encodeURIComponent(foyerId)}`;
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
        return etablissementVueSchema.parse(await reponse.json());
      },
      this.breaker,
      OPTIONS,
    );
  }

  /** PUT `/api/etablissements/:id` — modifie un établissement. */
  async modifierEtablissement(
    id: string,
    saisie: SaisieEtablissement,
  ): Promise<EtablissementVue> {
    const base = loadConfig().planificationUrl;
    const url = `${base}/api/etablissements/${encodeURIComponent(id)}`;
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
        return etablissementVueSchema.parse(await reponse.json());
      },
      this.breaker,
      OPTIONS,
    );
  }

  /** DELETE `/api/etablissements/:id` — supprime un établissement (204 ; 409 si rattaché). */
  async supprimerEtablissement(id: string): Promise<void> {
    const base = loadConfig().planificationUrl;
    const url = `${base}/api/etablissements/${encodeURIComponent(id)}`;
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
