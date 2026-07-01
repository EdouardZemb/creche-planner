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

  /** PUT `/api/foyers/:id` — édite les scalaires d'un foyer. */
  async mettreAJour(id: string, saisie: SaisieFoyer): Promise<FoyerVue> {
    const base = loadConfig().foyerUrl;
    const url = `${base}/api/foyers/${encodeURIComponent(id)}`;
    this.logger.debug(`PUT ${url}`);
    return executerResilient(
      'svc-foyer',
      async () => {
        const reponse = await fetchAvecTimeout(url, OPTIONS.timeoutMs, {
          method: 'PUT',
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

  /** PUT `/api/foyers/:id/enfants/:enfantId` — édite un enfant (prénom/date). */
  async modifierEnfant(
    foyerId: string,
    enfantId: string,
    saisie: SaisieEnfant,
  ): Promise<EnfantVue> {
    const base = loadConfig().foyerUrl;
    const url =
      `${base}/api/foyers/${encodeURIComponent(foyerId)}` +
      `/enfants/${encodeURIComponent(enfantId)}`;
    this.logger.debug(`PUT ${url}`);
    return executerResilient(
      'svc-foyer',
      async () => {
        const reponse = await fetchAvecTimeout(url, OPTIONS.timeoutMs, {
          method: 'PUT',
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

  /**
   * DELETE `/api/foyers/:id/enfants/:enfantId` — retire un enfant (hard delete
   * côté `svc-foyer`, réponse 204 sans corps).
   */
  async retirerEnfant(foyerId: string, enfantId: string): Promise<void> {
    const base = loadConfig().foyerUrl;
    const url =
      `${base}/api/foyers/${encodeURIComponent(foyerId)}` +
      `/enfants/${encodeURIComponent(enfantId)}`;
    this.logger.debug(`DELETE ${url}`);
    await executerResilient(
      'svc-foyer',
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

  /** GET `/api/foyers/:id/parents` — liste les parents actifs du foyer. */
  async parents(foyerId: string): Promise<ParentVue[]> {
    const base = loadConfig().foyerUrl;
    const url = `${base}/api/foyers/${encodeURIComponent(foyerId)}/parents`;
    this.logger.debug(`GET ${url}`);
    return executerResilient(
      'svc-foyer',
      async () => {
        const reponse = await fetchAvecTimeout(url, OPTIONS.timeoutMs);
        if (!reponse.ok) {
          throw new Error('HTTP ' + reponse.status);
        }
        return z.array(parentVueSchema).parse(await reponse.json());
      },
      this.breaker,
      OPTIONS,
    );
  }

  /** POST `/api/foyers/:id/parents` — rattache un parent. */
  async ajouterParent(
    foyerId: string,
    saisie: SaisieParent,
  ): Promise<ParentVue> {
    const base = loadConfig().foyerUrl;
    const url = `${base}/api/foyers/${encodeURIComponent(foyerId)}/parents`;
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
        return parentVueSchema.parse(await reponse.json());
      },
      this.breaker,
      OPTIONS,
    );
  }

  /** PUT `/api/foyers/:id/parents/:parentId` — édite un parent (champs fournis). */
  async modifierParent(
    foyerId: string,
    parentId: string,
    saisie: ModifierParentSaisie,
  ): Promise<ParentVue> {
    const base = loadConfig().foyerUrl;
    const url =
      `${base}/api/foyers/${encodeURIComponent(foyerId)}` +
      `/parents/${encodeURIComponent(parentId)}`;
    this.logger.debug(`PUT ${url}`);
    return executerResilient(
      'svc-foyer',
      async () => {
        const reponse = await fetchAvecTimeout(url, OPTIONS.timeoutMs, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(saisie),
        });
        if (!reponse.ok) {
          throw new Error('HTTP ' + reponse.status);
        }
        return parentVueSchema.parse(await reponse.json());
      },
      this.breaker,
      OPTIONS,
    );
  }

  /**
   * DELETE `/api/foyers/:id/parents/:parentId` — retire un parent (soft-delete
   * côté `svc-foyer`, réponse 204 sans corps).
   */
  async retirerParent(foyerId: string, parentId: string): Promise<void> {
    const base = loadConfig().foyerUrl;
    const url =
      `${base}/api/foyers/${encodeURIComponent(foyerId)}` +
      `/parents/${encodeURIComponent(parentId)}`;
    this.logger.debug(`DELETE ${url}`);
    await executerResilient(
      'svc-foyer',
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

  /**
   * GET `/api/foyers?parentEmail=…` — **résolution identité → foyers** : ids des
   * foyers dont l'e-mail est parent actif (familles recomposées → liste). Sert
   * l'autorisation par foyer (préparé pour le guard d'identité B1, PR5).
   */
  async foyersParEmail(email: string): Promise<string[]> {
    const base = loadConfig().foyerUrl;
    const url = `${base}/api/foyers?parentEmail=${encodeURIComponent(email)}`;
    this.logger.debug(`GET ${url}`);
    return executerResilient(
      'svc-foyer',
      async () => {
        const reponse = await fetchAvecTimeout(url, OPTIONS.timeoutMs);
        if (!reponse.ok) {
          throw new Error('HTTP ' + reponse.status);
        }
        return z.array(z.string()).parse(await reponse.json());
      },
      this.breaker,
      OPTIONS,
    );
  }

  /**
   * GET `/api/foyers/:id/parents/:parentId/preferences` — préférences de
   * notification **effectives** du parent (défaut applicatif + choix stockés).
   */
  async preferences(
    foyerId: string,
    parentId: string,
  ): Promise<PreferenceVue[]> {
    const base = loadConfig().foyerUrl;
    const url =
      `${base}/api/foyers/${encodeURIComponent(foyerId)}` +
      `/parents/${encodeURIComponent(parentId)}/preferences`;
    this.logger.debug(`GET ${url}`);
    return executerResilient(
      'svc-foyer',
      async () => {
        const reponse = await fetchAvecTimeout(url, OPTIONS.timeoutMs);
        if (!reponse.ok) {
          throw new Error('HTTP ' + reponse.status);
        }
        return z.array(preferenceVueSchema).parse(await reponse.json());
      },
      this.breaker,
      OPTIONS,
    );
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
    const base = loadConfig().foyerUrl;
    const url =
      `${base}/api/foyers/${encodeURIComponent(foyerId)}` +
      `/parents/${encodeURIComponent(parentId)}/preferences`;
    this.logger.debug(`PUT ${url}`);
    return executerResilient(
      'svc-foyer',
      async () => {
        const reponse = await fetchAvecTimeout(url, OPTIONS.timeoutMs, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(saisie),
        });
        if (!reponse.ok) {
          throw new Error('HTTP ' + reponse.status);
        }
        return z.array(preferenceVueSchema).parse(await reponse.json());
      },
      this.breaker,
      OPTIONS,
    );
  }
}
