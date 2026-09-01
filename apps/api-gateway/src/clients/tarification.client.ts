import { Injectable, Logger } from '@nestjs/common';
import { z, type ZodType } from 'zod';
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

/**
 * Suivi des unités associatives (SFD 40). Les trois compteurs et les deux coûts
 * projetés viennent du domaine ; le BFF les relaie tels quels, sans recalculer —
 * un second calcul côté passerelle serait une seconde vérité.
 */
const coutProjeteUaSchema = z.object({
  montantCentimes: z.number(),
  hypothese: z.enum(['SI_TU_TARRETES_LA', 'SI_TU_REALISES_TES_RESERVATIONS']),
});

const compteursUaSchema = z.object({
  quotaHeures: z.number(),
  heuresRealisees: z.number(),
  heuresReservees: z.number(),
  heuresAConfirmer: z.number(),
  heuresRestantes: z.number(),
  quotaAtteint: z.boolean(),
  joursAvantEcheance: z.number(),
  coutSiArret: coutProjeteUaSchema,
  coutSiReservationsRealisees: coutProjeteUaSchema,
  alerteEcheance: z.boolean(),
});

const engagementUaVueSchema = z.object({
  id: z.string(),
  foyerId: z.string(),
  debut: z.string(),
  fin: z.string(),
  quotaHeures: z.number(),
  valeurUaCentimes: z.number(),
  cautionCentimes: z.number().nullable(),
});

export type EngagementUaVue = z.infer<typeof engagementUaVueSchema>;

const sessionUaVueSchema = z.object({
  id: z.string(),
  engagementId: z.string(),
  date: z.string(),
  dureeHeures: z.number(),
  type: z.string(),
  realisePar: z.string().nullable(),
  etablissementId: z.string().nullable(),
  etat: z.string(),
  aConfirmer: z.boolean(),
});

export type SessionUaVue = z.infer<typeof sessionUaVueSchema>;

const suiviUaVueSchema = z.object({
  foyerId: z.string(),
  aujourdhui: z.string(),
  engagement: engagementUaVueSchema.nullable(),
  compteurs: compteursUaSchema.nullable(),
  sessions: z.array(sessionUaVueSchema),
  seuilAlerteJours: z.number(),
});

export type SuiviUaVue = z.infer<typeof suiviUaVueSchema>;

/** Part `svc-tarification` de l'export de portabilité (doc 37 §6). */
const exportUnitesAssociativesSchema = z.object({
  foyerId: z.string(),
  engagements: z.array(
    z.object({
      debut: z.string(),
      fin: z.string(),
      quotaHeures: z.number(),
      valeurUaCentimes: z.number(),
      cautionCentimes: z.number().nullable(),
      declareLe: z.string(),
      sessions: z.array(
        z.object({
          date: z.string(),
          dureeHeures: z.number(),
          type: z.string(),
          realisePar: z.string().nullable(),
          etat: z.string(),
          saisieLe: z.string(),
        }),
      ),
    }),
  ),
  pisteAudit: z.array(
    z.object({
      action: z.string(),
      cibleType: z.string(),
      cibleId: z.string().nullable(),
      acteurType: z.string(),
      acteur: z.string().nullable(),
      le: z.string(),
    }),
  ),
});

export type ExportUnitesAssociativesVue = z.infer<
  typeof exportUnitesAssociativesSchema
>;

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

  /**
   * Appel résilient générique vers `svc-tarification` pour les routes « unités
   * associatives », dont les corps et les codes d'erreur (409, 404) doivent
   * remonter tels quels au front — d'où `capturerCorpsErreur`.
   */
  private appelUa<T>(config: {
    methode: 'GET' | 'POST' | 'PUT' | 'DELETE';
    chemin: string;
    corps?: unknown;
    schema: ZodType<T>;
  }): Promise<T>;
  private appelUa(config: {
    methode: 'GET' | 'POST' | 'PUT' | 'DELETE';
    chemin: string;
    corps?: unknown;
  }): Promise<void>;
  private appelUa<T>(config: {
    methode: 'GET' | 'POST' | 'PUT' | 'DELETE';
    chemin: string;
    corps?: unknown;
    schema?: ZodType<T> | undefined;
  }): Promise<T | void> {
    const commun = {
      service: 'svc-tarification',
      logger: this.logger,
      breaker: this.breaker,
      options: OPTIONS,
      methode: config.methode,
      url: `${loadConfig().tarificationUrl}${config.chemin}`,
      corps: config.corps,
      capturerCorpsErreur: true,
    };
    return config.schema === undefined
      ? appelResilient(commun)
      : appelResilient({ ...commun, schema: config.schema });
  }

  /** GET `/api/unites-associatives` — suivi du foyer (compteurs + sessions). */
  async suiviUnitesAssociatives(foyerId: string): Promise<SuiviUaVue> {
    return this.appelUa({
      methode: 'GET',
      chemin: `/api/unites-associatives?foyer=${encodeURIComponent(foyerId)}`,
      schema: suiviUaVueSchema,
    });
  }

  /** POST `/api/unites-associatives` — déclare l'engagement d'une période. */
  async declarerEngagementUa(
    foyerId: string,
    saisie: unknown,
  ): Promise<EngagementUaVue> {
    return this.appelUa({
      methode: 'POST',
      chemin: `/api/unites-associatives?foyer=${encodeURIComponent(foyerId)}`,
      corps: saisie,
      schema: engagementUaVueSchema,
    });
  }

  /** POST `/api/unites-associatives/sessions` — note un créneau déjà réservé. */
  async ajouterSessionUa(
    foyerId: string,
    saisie: unknown,
  ): Promise<SessionUaVue> {
    return this.appelUa({
      methode: 'POST',
      chemin: `/api/unites-associatives/sessions?foyer=${encodeURIComponent(foyerId)}`,
      corps: saisie,
      schema: sessionUaVueSchema,
    });
  }

  /** PUT `/api/unites-associatives/sessions/:id` — réalisée, annulée, corrigée. */
  async modifierSessionUa(
    foyerId: string,
    sessionId: string,
    saisie: unknown,
  ): Promise<SessionUaVue> {
    return this.appelUa({
      methode: 'PUT',
      chemin:
        `/api/unites-associatives/sessions/${encodeURIComponent(sessionId)}` +
        `?foyer=${encodeURIComponent(foyerId)}`,
      corps: saisie,
      schema: sessionUaVueSchema,
    });
  }

  /** DELETE `/api/unites-associatives/sessions/:id` — 204 sans corps. */
  async supprimerSessionUa(foyerId: string, sessionId: string): Promise<void> {
    await this.appelUa({
      methode: 'DELETE',
      chemin:
        `/api/unites-associatives/sessions/${encodeURIComponent(sessionId)}` +
        `?foyer=${encodeURIComponent(foyerId)}`,
    });
  }

  /** GET `/api/foyers/:id/export` — part UA de l'export de portabilité. */
  async exporter(foyerId: string): Promise<ExportUnitesAssociativesVue> {
    return this.appelUa({
      methode: 'GET',
      chemin: `/api/foyers/${encodeURIComponent(foyerId)}/export`,
      schema: exportUnitesAssociativesSchema,
    });
  }
}
