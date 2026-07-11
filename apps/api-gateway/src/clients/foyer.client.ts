import { Injectable, Logger } from '@nestjs/common';
import { z, type ZodType } from 'zod';
import {
  CircuitBreaker,
  fetchAvecTimeout,
  type OptionsResilience,
} from '@creche-planner/resilience';
import { loadConfig } from '../config.js';
import { appelResilient, type MethodeHttp } from './appel-resilient.js';

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

/**
 * Saisie de rattachement d'un parent. `email` requis (destinataire des
 * notifications + futur identifiant de login) ; le reste est une identité douce
 * optionnelle. `principal`/`ordre` ont un défaut côté `svc-foyer`.
 */
export interface SaisieParent {
  readonly email: string;
  // `| undefined` explicite : aligne avec la sortie Zod (`.optional()`) sous
  // `exactOptionalPropertyTypes`, le DTO BFF étant relayé tel quel.
  readonly prenom?: string | undefined;
  readonly nom?: string | undefined;
  readonly principal?: boolean | undefined;
  readonly ordre?: number | undefined;
}

/**
 * Saisie d'édition d'un parent (`PUT`). Tous les champs optionnels : seuls ceux
 * fournis sont modifiés. `prenom`/`nom` acceptent `null` pour effacer l'identité
 * douce ; `actif` permet de réactiver un parent retiré (soft-delete).
 */
export interface ModifierParentSaisie {
  readonly email?: string | undefined;
  readonly prenom?: string | null | undefined;
  readonly nom?: string | null | undefined;
  readonly principal?: boolean | undefined;
  readonly ordre?: number | undefined;
  readonly actif?: boolean | undefined;
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

/** Vue lecture d'un parent rattaché à un foyer (e-mail = PII). */
const parentVueSchema = z.object({
  id: z.string(),
  foyerId: z.string(),
  prenom: z.string().nullable(),
  nom: z.string().nullable(),
  email: z.string(),
  principal: z.boolean(),
  ordre: z.number(),
  actif: z.boolean(),
});

export type ParentVue = z.infer<typeof parentVueSchema>;

/**
 * Vue lecture d'une **préférence de notification effective** d'un parent (défaut
 * applicatif fusionné avec le choix stocké, cf. `svc-foyer`). `consentementAt` /
 * `desabonneAt` tracent l'opt-in/opt-out (ISO ou `null` tant que non posés).
 */
const preferenceVueSchema = z.object({
  typeNotification: z.string(),
  canal: z.string(),
  actif: z.boolean(),
  consentementAt: z.string().nullable(),
  desabonneAt: z.string().nullable(),
});

export type PreferenceVue = z.infer<typeof preferenceVueSchema>;

/**
 * Choix explicite `(type, canal, actif)` à matérialiser (corps du `PUT`). Relayé
 * tel quel à `svc-foyer`, qui applique l'invariant « ≥ 1 canal actif pour un type
 * de service ». Les enums restent des `string` ici (validation profonde en amont).
 */
export interface SaisiePreference {
  readonly typeNotification: string;
  readonly canal: string;
  readonly actif: boolean;
}

/** Mise à jour des préférences d'un parent : liste des choix explicites. */
export interface MajPreferencesSaisie {
  readonly preferences: readonly SaisiePreference[];
}

const OPTIONS: OptionsResilience = {
  timeoutMs: 2000,
  retries: 1,
  delaiEntreEssaisMs: 200,
};

/**
 * Client REST résilient vers `svc-foyer` (port 3002). Sur le chemin critique
 * du BFF : timeout + retry borné + circuit-breaker, mais **propagation** des
 * erreurs (`executerResilient`) afin que le contrôleur remonte un code propre.
 * Le squelette commun par endpoint (fetch + garde `ok` + parse Zod) est
 * factorisé dans `appelResilient` ; chaque méthode ne déclare plus que sa
 * méthode HTTP, son chemin, son corps éventuel et le schéma de sa réponse.
 */
@Injectable()
export class FoyerClient {
  private readonly logger = new Logger(FoyerClient.name);
  private readonly breaker = new CircuitBreaker();

  /** Appel résilient vers `svc-foyer`, `chemin` relatif à la base configurée. */
  private appel<T>(config: {
    methode: MethodeHttp;
    chemin: string;
    corps?: unknown;
    schema: ZodType<T>;
  }): Promise<T>;
  private appel(config: {
    methode: MethodeHttp;
    chemin: string;
    corps?: unknown;
  }): Promise<void>;
  private appel<T>(config: {
    methode: MethodeHttp;
    chemin: string;
    corps?: unknown;
    schema?: ZodType<T> | undefined;
  }): Promise<T | void> {
    const commun = {
      service: 'svc-foyer',
      logger: this.logger,
      breaker: this.breaker,
      options: OPTIONS,
      methode: config.methode,
      url: `${loadConfig().foyerUrl}${config.chemin}`,
      corps: config.corps,
      // svc-foyer porte des 409 structurés (`code`) que le front doit distinguer :
      // on capture le corps d'erreur amont pour que `relayer` le réémette tel quel.
      capturerCorpsErreur: true,
    };
    return config.schema === undefined
      ? appelResilient(commun)
      : appelResilient({ ...commun, schema: config.schema });
  }

  /** POST `/api/foyers` — crée un foyer. */
  async creerFoyer(saisie: SaisieFoyer): Promise<FoyerVue> {
    return this.appel({
      methode: 'POST',
      chemin: '/api/foyers',
      corps: saisie,
      schema: foyerVueSchema,
    });
  }

  /** PUT `/api/foyers/:id` — édite les scalaires d'un foyer. */
  async mettreAJour(id: string, saisie: SaisieFoyer): Promise<FoyerVue> {
    return this.appel({
      methode: 'PUT',
      chemin: `/api/foyers/${encodeURIComponent(id)}`,
      corps: saisie,
      schema: foyerVueSchema,
    });
  }

  /** POST `/api/foyers/:id/enfants` — rattache un enfant. */
  async ajouterEnfant(
    foyerId: string,
    saisie: SaisieEnfant,
  ): Promise<EnfantVue> {
    return this.appel({
      methode: 'POST',
      chemin: `/api/foyers/${encodeURIComponent(foyerId)}/enfants`,
      corps: saisie,
      schema: enfantVueSchema,
    });
  }

  /** PUT `/api/foyers/:id/enfants/:enfantId` — édite un enfant (prénom/date). */
  async modifierEnfant(
    foyerId: string,
    enfantId: string,
    saisie: SaisieEnfant,
  ): Promise<EnfantVue> {
    return this.appel({
      methode: 'PUT',
      chemin:
        `/api/foyers/${encodeURIComponent(foyerId)}` +
        `/enfants/${encodeURIComponent(enfantId)}`,
      corps: saisie,
      schema: enfantVueSchema,
    });
  }

  /**
   * DELETE `/api/foyers/:id/enfants/:enfantId` — retire un enfant (hard delete
   * côté `svc-foyer`, réponse 204 sans corps).
   */
  async retirerEnfant(foyerId: string, enfantId: string): Promise<void> {
    await this.appel({
      methode: 'DELETE',
      chemin:
        `/api/foyers/${encodeURIComponent(foyerId)}` +
        `/enfants/${encodeURIComponent(enfantId)}`,
    });
  }

  /** GET `/api/foyers` — liste les foyers existants. */
  async lister(): Promise<FoyerVue[]> {
    return this.appel({
      methode: 'GET',
      chemin: '/api/foyers',
      schema: z.array(foyerVueSchema),
    });
  }

  /** GET `/api/foyers/:id` — lit un foyer. */
  async foyer(foyerId: string): Promise<FoyerVue> {
    return this.appel({
      methode: 'GET',
      chemin: `/api/foyers/${encodeURIComponent(foyerId)}`,
      schema: foyerVueSchema,
    });
  }

  /** GET `/api/foyers/:id/enfants` — liste les enfants du foyer. */
  async enfants(foyerId: string): Promise<EnfantVue[]> {
    return this.appel({
      methode: 'GET',
      chemin: `/api/foyers/${encodeURIComponent(foyerId)}/enfants`,
      schema: z.array(enfantVueSchema),
    });
  }

  /** GET `/api/foyers/:id/parents` — liste les parents actifs du foyer. */
  async parents(foyerId: string): Promise<ParentVue[]> {
    return this.appel({
      methode: 'GET',
      chemin: `/api/foyers/${encodeURIComponent(foyerId)}/parents`,
      schema: z.array(parentVueSchema),
    });
  }

  /** POST `/api/foyers/:id/parents` — rattache un parent. */
  async ajouterParent(
    foyerId: string,
    saisie: SaisieParent,
  ): Promise<ParentVue> {
    return this.appel({
      methode: 'POST',
      chemin: `/api/foyers/${encodeURIComponent(foyerId)}/parents`,
      corps: saisie,
      schema: parentVueSchema,
    });
  }

  /** PUT `/api/foyers/:id/parents/:parentId` — édite un parent (champs fournis). */
  async modifierParent(
    foyerId: string,
    parentId: string,
    saisie: ModifierParentSaisie,
  ): Promise<ParentVue> {
    return this.appel({
      methode: 'PUT',
      chemin:
        `/api/foyers/${encodeURIComponent(foyerId)}` +
        `/parents/${encodeURIComponent(parentId)}`,
      corps: saisie,
      schema: parentVueSchema,
    });
  }

  /**
   * DELETE `/api/foyers/:id/parents/:parentId` — retire un parent (soft-delete
   * côté `svc-foyer`, réponse 204 sans corps).
   */
  async retirerParent(foyerId: string, parentId: string): Promise<void> {
    await this.appel({
      methode: 'DELETE',
      chemin:
        `/api/foyers/${encodeURIComponent(foyerId)}` +
        `/parents/${encodeURIComponent(parentId)}`,
    });
  }

  /**
   * GET `/api/foyers?parentEmail=…` — **résolution identité → foyers** : ids des
   * foyers dont l'e-mail est parent actif (familles recomposées → liste). Sert
   * l'autorisation par foyer (préparé pour le guard d'identité B1, PR5).
   */
  async foyersParEmail(email: string): Promise<string[]> {
    return this.appel({
      methode: 'GET',
      chemin: `/api/foyers?parentEmail=${encodeURIComponent(email)}`,
      schema: z.array(z.string()),
    });
  }

  /**
   * GET `/api/foyers/:id/parents/:parentId/preferences` — préférences de
   * notification **effectives** du parent (défaut applicatif + choix stockés).
   */
  async preferences(
    foyerId: string,
    parentId: string,
  ): Promise<PreferenceVue[]> {
    return this.appel({
      methode: 'GET',
      chemin:
        `/api/foyers/${encodeURIComponent(foyerId)}` +
        `/parents/${encodeURIComponent(parentId)}/preferences`,
      schema: z.array(preferenceVueSchema),
    });
  }

  /**
   * PUT `/api/foyers/:id/parents/:parentId/preferences` — met à jour les
   * préférences du parent. `svc-foyer` refuse (400) une combinaison coupant tous
   * les canaux d'un type de service ; l'erreur est relayée telle quelle.
   */
  async majPreferences(
    foyerId: string,
    parentId: string,
    saisie: MajPreferencesSaisie,
  ): Promise<PreferenceVue[]> {
    return this.appel({
      methode: 'PUT',
      chemin:
        `/api/foyers/${encodeURIComponent(foyerId)}` +
        `/parents/${encodeURIComponent(parentId)}/preferences`,
      corps: saisie,
      schema: z.array(preferenceVueSchema),
    });
  }

  /**
   * POST `/api/desabonnement` — consomme un jeton de désabonnement one-click
   * (RFC 8058). **Volontairement SANS retry ni circuit-breaker** : l'opération est
   * **one-shot** (le jeton est brûlé au premier succès) ; un ré-essai transformerait
   * un 204 réussi en 400 « déjà utilisé ». On propage donc le statut amont tel quel
   * (204 succès, `409` dernier canal d'un service, `400` jeton invalide/expiré/déjà
   * utilisé) via `Error('HTTP <code>')`, que `relayer` réémet à l'identique.
   */
  async desabonner(token: string): Promise<void> {
    const base = loadConfig().foyerUrl;
    const url = `${base}/api/desabonnement`;
    this.logger.debug(`POST ${url}`);
    const reponse = await fetchAvecTimeout(url, OPTIONS.timeoutMs, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token }),
    });
    if (!reponse.ok) {
      throw new Error('HTTP ' + String(reponse.status));
    }
  }
}
