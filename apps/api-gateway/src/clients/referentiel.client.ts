import { Injectable, Logger } from '@nestjs/common';
import { z, type ZodType } from 'zod';
import {
  CircuitBreaker,
  type OptionsResilience,
} from '@creche-planner/resilience';
import { loadConfig } from '../config.js';
import { appelResilient, type MethodeHttp } from './appel-resilient.js';

/** Vue d'une ligne de grille ABCM publiée (montants en centimes entiers). */
const grilleAbcmVueSchema = z.object({
  id: z.string(),
  tranche: z.number(),
  valideDu: z.string(),
  valideAu: z.string().nullable(),
  cantineTotalCentimes: z.number(),
  cantinePartGardeCentimes: z.number().nullable(),
  periMatinCentimes: z.number(),
  periSoirCentimes: z.number(),
  alshJourneeCompleteCentimes: z.number(),
  alshDemiJourneeCentimes: z.number(),
  alshRepasCentimes: z.number(),
});

export type GrilleAbcmVue = z.infer<typeof grilleAbcmVueSchema>;

const grillesVueSchema = z.array(grilleAbcmVueSchema);

/** Vue d'un barème PSU publié (taux + bornes CNAF en centimes). */
const baremePsuVueSchema = z.object({
  id: z.string(),
  valideDu: z.string(),
  valideAu: z.string().nullable(),
  taux: z.record(z.string(), z.number()),
  plancherCentimes: z.number().nullable(),
  plafondCentimes: z.number().nullable(),
});

export type BaremePsuVue = z.infer<typeof baremePsuVueSchema>;

/** Vue d'un barème de seuils de tranche publié (bornes hautes en centimes). */
const baremeTranchesVueSchema = z.object({
  id: z.string(),
  valideDu: z.string(),
  valideAu: z.string().nullable(),
  seuils: z.array(
    z.object({
      niveau: z.number(),
      rfrMaxCentimes: z.number().nullable(),
    }),
  ),
});

export type BaremeTranchesVue = z.infer<typeof baremeTranchesVueSchema>;

const OPTIONS: OptionsResilience = {
  timeoutMs: 2000,
  retries: 1,
  delaiEntreEssaisMs: 200,
};

/**
 * Client REST résilient vers `svc-referentiel` (port 3001) pour la **publication
 * de grilles/barèmes** (SFD 30, lot 6). Comme `FoyerClient`, il capture le corps
 * d'erreur amont (`capturerCorpsErreur`) pour que `relayer` réémette le **409
 * structuré** (`{ code: 'PERIODE_CHEVAUCHANTE' }`) tel quel — l'écran affiche alors
 * un message clair d'anti-chevauchement. Le catalogue est **global** : aucune de
 * ces routes n'est scopée par foyer.
 */
@Injectable()
export class ReferentielClient {
  private readonly logger = new Logger(ReferentielClient.name);
  private readonly breaker = new CircuitBreaker();

  private appel<T>(config: {
    methode: MethodeHttp;
    chemin: string;
    corps?: unknown;
    schema: ZodType<T>;
  }): Promise<T> {
    return appelResilient({
      service: 'svc-referentiel',
      logger: this.logger,
      breaker: this.breaker,
      options: OPTIONS,
      methode: config.methode,
      url: `${loadConfig().referentielUrl}${config.chemin}`,
      corps: config.corps,
      schema: config.schema,
      capturerCorpsErreur: true,
    });
  }

  /** GET `/api/grilles` — toutes les grilles ABCM publiées (écran « Tarifs »). */
  async listerGrilles(): Promise<GrilleAbcmVue[]> {
    return this.appel({
      methode: 'GET',
      chemin: '/api/grilles',
      schema: grillesVueSchema,
    });
  }

  /** POST `/api/grilles/abcm` — publie une grille complète (201 ; **409** si chevauchement). */
  async publierGrille(corps: unknown): Promise<GrilleAbcmVue[]> {
    return this.appel({
      methode: 'POST',
      chemin: '/api/grilles/abcm',
      corps,
      schema: grillesVueSchema,
    });
  }

  /** POST `/api/baremes/psu` — publie un barème PSU (201 ; **409** si chevauchement). */
  async publierBaremePsu(corps: unknown): Promise<BaremePsuVue> {
    return this.appel({
      methode: 'POST',
      chemin: '/api/baremes/psu',
      corps,
      schema: baremePsuVueSchema,
    });
  }

  /** POST `/api/baremes/tranches` — publie un barème de seuils de tranche (201 ; **409**). */
  async publierBaremeTranches(corps: unknown): Promise<BaremeTranchesVue> {
    return this.appel({
      methode: 'POST',
      chemin: '/api/baremes/tranches',
      corps,
      schema: baremeTranchesVueSchema,
    });
  }
}
