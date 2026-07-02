import { Injectable, Logger } from '@nestjs/common';
import { z } from 'zod';
import { loadConfig } from '../config.js';
import {
  CircuitBreaker,
  executerResilient,
  fetchAvecTimeout,
  type OptionsResilience,
} from '@creche-planner/resilience';

/** Statut d'une validation hebdomadaire renvoyé par `svc-notifications`. */
const statutSchema = z.enum(['A_VALIDER', 'VALIDEE', 'VALIDEE_AVEC_MODIFS']);

/** Une semaine à valider (indicateur in-app). */
const notificationAValiderSchema = z.object({
  contratId: z.string(),
  foyerId: z.string(),
  semaineIso: z.string(),
  statut: statutSchema,
  notifieeLe: z.string(),
});

export type NotificationAValiderVue = z.infer<
  typeof notificationAValiderSchema
>;

/**
 * Résultat d'une validation. `deltaModifs` (forme libre de svc-notifications) n'est
 * pas redéclaré champ par champ ici : la gateway le **relaie** tel quel (validation
 * profonde côté service), seul son caractère nullable est contraint.
 */
const validationResultatSchema = z.object({
  contratId: z.string(),
  semaineIso: z.string(),
  statut: statutSchema,
  deltaModifs: z.record(z.string(), z.unknown()).nullable(),
});

export type ValidationResultat = z.infer<typeof validationResultatSchema>;

/** Un jour modifié (diff figé du Lot 4), relayé tel quel au front. */
const deltaJourSchema = z.object({
  date: z.string(),
  avant: z.unknown(),
  apres: z.unknown(),
});

/** Jours modifiés affichés dans la relecture. */
const deltaModifsSchema = z.object({ jours: z.array(deltaJourSchema) });

/** Un enfant du foyer concerné par le récap agrégé (diff figé du Lot 4). */
const enfantBrouillonSchema = z.object({
  contratId: z.string(),
  enfant: z.string(),
  deltaModifs: deltaModifsSchema,
});

/**
 * Brouillon régénérable du mail **agrégé par établissement** (édition hebdo, Phase 4) :
 * un seul mail par établissement regroupant tous les enfants du foyer dont la semaine
 * a été validée avec modifications.
 */
const brouillonEtablissementSchema = z.object({
  foyerId: z.string(),
  semaineIso: z.string(),
  etablissementId: z.string(),
  etablissementLibelle: z.string(),
  destinataire: z.string(),
  sujet: z.string(),
  corps: z.string(),
  texte: z.string(),
  enfants: z.array(enfantBrouillonSchema),
  dryRun: z.boolean(),
});

export type BrouillonEtablissementVue = z.infer<
  typeof brouillonEtablissementSchema
>;

/** Statut d'un envoi de récap au service. */
const statutEnvoiSchema = z.enum(['EN_COURS', 'ENVOYE', 'ECHEC', 'DRY_RUN']);

/** Résultat d'un envoi agrégé : issue réelle de l'action sortante par établissement. */
const envoiEtablissementResultatSchema = z.object({
  foyerId: z.string(),
  semaineIso: z.string(),
  etablissementId: z.string(),
  destinataire: z.string(),
  statut: statutEnvoiSchema,
  messageId: z.string().nullable(),
  erreur: z.string().nullable(),
  envoyeLe: z.string().nullable(),
});

export type EnvoiEtablissementResultat = z.infer<
  typeof envoiEtablissementResultatSchema
>;

/** Une notification in-app d'un parent (inbox générique, PR6). */
const notificationInAppSchema = z.object({
  id: z.string(),
  type: z.string(),
  sujet: z.string(),
  corps: z.string(),
  creeLe: z.string(),
  luLe: z.string().nullable(),
});

export type NotificationInAppVue = z.infer<typeof notificationInAppSchema>;

/** Panneau de l'inbox : les notifications récentes + le compteur de non-lus. */
const inboxSchema = z.object({
  notifications: z.array(notificationInAppSchema),
  nonLus: z.number(),
});

export type InboxVue = z.infer<typeof inboxSchema>;

const OPTIONS: OptionsResilience = {
  timeoutMs: 2000,
  retries: 1,
  delaiEntreEssaisMs: 200,
};

/**
 * Client REST résilient vers `svc-notifications` (port 3006). Même profil que les
 * autres clients du BFF : timeout + retry borné + circuit-breaker, avec
 * **propagation** des erreurs (`executerResilient`) traduites ensuite en HTTP par
 * le contrôleur BFF.
 */
@Injectable()
export class NotificationsClient {
  private readonly logger = new Logger(NotificationsClient.name);
  private readonly breaker = new CircuitBreaker();

  /** GET `/api/validations/a-valider?foyer=` — semaines à valider d'un foyer. */
  async listerAValider(foyerId: string): Promise<NotificationAValiderVue[]> {
    const base = loadConfig().notificationsUrl;
    const url = `${base}/api/validations/a-valider?foyer=${encodeURIComponent(foyerId)}`;
    this.logger.debug(`GET ${url}`);
    return executerResilient(
      'svc-notifications',
      async () => {
        const reponse = await fetchAvecTimeout(url, OPTIONS.timeoutMs);
        if (!reponse.ok) {
          throw new Error('HTTP ' + reponse.status);
        }
        return z.array(notificationAValiderSchema).parse(await reponse.json());
      },
      this.breaker,
      OPTIONS,
    );
  }

  /** POST `/api/validations/:contratId/:semaineIso` — valide une semaine. */
  async validerSemaine(
    contratId: string,
    semaineIso: string,
  ): Promise<ValidationResultat> {
    const base = loadConfig().notificationsUrl;
    const url =
      `${base}/api/validations/${encodeURIComponent(contratId)}` +
      `/${encodeURIComponent(semaineIso)}`;
    this.logger.debug(`POST ${url}`);
    return executerResilient(
      'svc-notifications',
      async () => {
        const reponse = await fetchAvecTimeout(url, OPTIONS.timeoutMs, {
          method: 'POST',
        });
        if (!reponse.ok) {
          throw new Error('HTTP ' + reponse.status);
        }
        return validationResultatSchema.parse(await reponse.json());
      },
      this.breaker,
      OPTIONS,
    );
  }

  /**
   * GET `/api/validations/semaine/:foyerId/:semaineIso/etablissements/:etablissementId/brouillon`
   * — régénère le brouillon **agrégé par établissement** (tous les enfants du foyer).
   */
  async lireBrouillonEtablissement(
    foyerId: string,
    semaineIso: string,
    etablissementId: string,
  ): Promise<BrouillonEtablissementVue> {
    const base = loadConfig().notificationsUrl;
    const url =
      `${base}/api/validations/semaine/${encodeURIComponent(foyerId)}` +
      `/${encodeURIComponent(semaineIso)}/etablissements/${encodeURIComponent(etablissementId)}/brouillon`;
    this.logger.debug(`GET ${url}`);
    return executerResilient(
      'svc-notifications',
      async () => {
        const reponse = await fetchAvecTimeout(url, OPTIONS.timeoutMs);
        if (!reponse.ok) {
          throw new Error('HTTP ' + reponse.status);
        }
        return brouillonEtablissementSchema.parse(await reponse.json());
      },
      this.breaker,
      OPTIONS,
    );
  }

  /**
   * GET `/api/moi/notifications?parent=` — inbox in-app d'un parent (liste récente +
   * compteur de non-lus). Le `parentId` est résolu **côté BFF** depuis l'identité
   * (jamais fourni par le navigateur), puis relayé ici comme un `foyer` de la validation.
   */
  async listerInbox(parentId: string): Promise<InboxVue> {
    const base = loadConfig().notificationsUrl;
    const url = `${base}/api/moi/notifications?parent=${encodeURIComponent(parentId)}`;
    this.logger.debug(`GET ${url}`);
    return executerResilient(
      'svc-notifications',
      async () => {
        const reponse = await fetchAvecTimeout(url, OPTIONS.timeoutMs);
        if (!reponse.ok) {
          throw new Error('HTTP ' + reponse.status);
        }
        return inboxSchema.parse(await reponse.json());
      },
      this.breaker,
      OPTIONS,
    );
  }

  /**
   * POST `/api/moi/notifications/:id/lu?parent=` — marque une notification du parent
   * comme lue (accusé de lecture). Le `parentId` scope l'écriture côté service
   * (défense en profondeur : un parent ne marque que **ses** notifications ; 404 sinon).
   */
  async marquerNotificationLue(
    parentId: string,
    id: string,
  ): Promise<NotificationInAppVue> {
    const base = loadConfig().notificationsUrl;
    const url =
      `${base}/api/moi/notifications/${encodeURIComponent(id)}/lu` +
      `?parent=${encodeURIComponent(parentId)}`;
    this.logger.debug(`POST ${url}`);
    return executerResilient(
      'svc-notifications',
      async () => {
        const reponse = await fetchAvecTimeout(url, OPTIONS.timeoutMs, {
          method: 'POST',
        });
        if (!reponse.ok) {
          throw new Error('HTTP ' + reponse.status);
        }
        return notificationInAppSchema.parse(await reponse.json());
      },
      this.breaker,
      OPTIONS,
    );
  }

  /**
   * POST `/api/envois/etablissement` — envoie réellement le récap **agrégé par
   * établissement** au service (idempotent sur `(foyer, semaine, établissement)`).
   */
  async envoyerRecapEtablissement(
    foyerId: string,
    semaineIso: string,
    etablissementId: string,
  ): Promise<EnvoiEtablissementResultat> {
    const base = loadConfig().notificationsUrl;
    const url = `${base}/api/envois/etablissement`;
    this.logger.debug(`POST ${url}`);
    return executerResilient(
      'svc-notifications',
      async () => {
        const reponse = await fetchAvecTimeout(url, OPTIONS.timeoutMs, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ foyerId, semaineIso, etablissementId }),
        });
        if (!reponse.ok) {
          throw new Error('HTTP ' + reponse.status);
        }
        return envoiEtablissementResultatSchema.parse(await reponse.json());
      },
      this.breaker,
      OPTIONS,
    );
  }
}
