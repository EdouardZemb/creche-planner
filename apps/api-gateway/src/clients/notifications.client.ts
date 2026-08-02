import { Injectable, Logger } from '@nestjs/common';
import { z, type ZodType } from 'zod';
import { loadConfig } from '../config.js';
import {
  CircuitBreaker,
  type OptionsResilience,
} from '@creche-planner/resilience';
import { appelResilient, type MethodeHttp } from './appel-resilient.js';

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
  // Vide `''` quand non routable (établissement sans e-mail) : le front ne le lit que
  // si `routable === true`.
  destinataire: z.string(),
  sujet: z.string(),
  corps: z.string(),
  texte: z.string(),
  enfants: z.array(enfantBrouillonSchema),
  // Angles morts « crèche sans e-mail » (Lot 2) et « crèche archivée » (Lot 3) : un
  // établissement non joignable revient `routable:false` (au lieu d'un 404 silencieux).
  // `'ARCHIVE'` a la priorité sur `'SANS_EMAIL'` côté service.
  routable: z.boolean(),
  raisonNonRoutable: z.enum(['SANS_EMAIL', 'ARCHIVE']).nullable(),
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

// --- Suivi des envois (B1, lecture seule) -----------------------------------

/** Livraison du récap du mardi vers un parent (ledger `envoi_recap_parent`). */
const suiviRappelParentSchema = z.object({
  email: z.string(),
  statut: z.enum(['ENVOYE', 'DRY_RUN', 'ECHEC']),
  envoyeLe: z.string().nullable(),
  essais: z.number(),
});

/** État d'envoi du rappel hebdo du mardi (agrégat + détail par parent). */
const suiviRappelSchema = z.object({
  statut: z.enum(['A_ENVOYER', 'ENVOYE', 'DRY_RUN', 'ECHEC', 'ABANDONNE']),
  envoyeLe: z.string().nullable(),
  erreur: z.string().nullable(),
  parents: z.array(suiviRappelParentSchema),
});

/** État d'envoi du récap agrégé vers un établissement (`envoi_etablissement`). */
const suiviEnvoiEtablissementSchema = z.object({
  etablissementId: z.string(),
  statut: statutEnvoiSchema,
  envoyeLe: z.string().nullable(),
  erreur: z.string().nullable(),
  destinataire: z.string().nullable(),
});

/**
 * Vue lecture seule du suivi des envois d'une `(foyer, semaine)` : statut persistant du
 * rappel aux parents (`null` si la semaine n'a jamais été programmée) et des récaps aux
 * établissements. Alimente le bloc « Suivi des envois » de l'encart de validation.
 */
const suiviEnvoisSchema = z.object({
  foyerId: z.string(),
  semaineIso: z.string(),
  rappel: suiviRappelSchema.nullable(),
  etablissements: z.array(suiviEnvoiEtablissementSchema),
});

export type SuiviEnvoisVue = z.infer<typeof suiviEnvoisSchema>;

/** Une notification in-app d'un parent (inbox générique, PR6). */
const notificationInAppSchema = z.object({
  id: z.string(),
  type: z.string(),
  sujet: z.string(),
  corps: z.string(),
  // Lien profond in-app (chemin relatif) rendant la carte tapable. Ajout **optionnel**
  // côté consommateur (compat ascendante : les réponses/entrées legacy peuvent l'omettre).
  lien: z.string().nullish(),
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

/**
 * `GET /api/foyers/:id/mois-communiques` renvoie `{ mois: [...] }` : le schéma
 * **déplie** l'enveloppe pour que la valeur utile soit celle que le client
 * expose (aucune projection à faire hors de l'appel).
 */
const moisCommuniquesSchema = z
  .object({ mois: z.array(z.string()) })
  .transform((reponse) => reponse.mois);

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

  /** Appel résilient vers `svc-notifications`, `chemin` relatif à la base configurée. */
  private appel<T>(config: {
    methode: MethodeHttp;
    chemin: string;
    corps?: unknown;
    schema: ZodType<T>;
  }): Promise<T> {
    return appelResilient({
      service: 'svc-notifications',
      logger: this.logger,
      breaker: this.breaker,
      options: OPTIONS,
      methode: config.methode,
      url: `${loadConfig().notificationsUrl}${config.chemin}`,
      corps: config.corps,
      schema: config.schema,
    });
  }

  /** GET `/api/validations/a-valider?foyer=` — semaines à valider d'un foyer. */
  async listerAValider(foyerId: string): Promise<NotificationAValiderVue[]> {
    return this.appel({
      methode: 'GET',
      chemin: `/api/validations/a-valider?foyer=${encodeURIComponent(foyerId)}`,
      schema: z.array(notificationAValiderSchema),
    });
  }

  /** POST `/api/validations/:contratId/:semaineIso` — valide une semaine. */
  async validerSemaine(
    contratId: string,
    semaineIso: string,
  ): Promise<ValidationResultat> {
    return this.appel({
      methode: 'POST',
      chemin:
        `/api/validations/${encodeURIComponent(contratId)}` +
        `/${encodeURIComponent(semaineIso)}`,
      schema: validationResultatSchema,
    });
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
    return this.appel({
      methode: 'GET',
      chemin:
        `/api/validations/semaine/${encodeURIComponent(foyerId)}` +
        `/${encodeURIComponent(semaineIso)}/etablissements/${encodeURIComponent(etablissementId)}/brouillon`,
      schema: brouillonEtablissementSchema,
    });
  }

  /**
   * GET `/api/validations/semaine/:foyerId/:semaineIso/envois` (B1) — suivi **lecture
   * seule** des envois de la semaine : statut persistant du rappel aux parents et des
   * récaps aux établissements. Même enveloppe résiliente que les voisins.
   */
  async lireSuiviEnvois(
    foyerId: string,
    semaineIso: string,
  ): Promise<SuiviEnvoisVue> {
    return this.appel({
      methode: 'GET',
      chemin:
        `/api/validations/semaine/${encodeURIComponent(foyerId)}` +
        `/${encodeURIComponent(semaineIso)}/envois`,
      schema: suiviEnvoisSchema,
    });
  }

  /**
   * GET `/api/foyers/:foyerId/mois-communiques?du=&au=` (SFD 30, US-30-05) — mois
   * `YYYY-MM` d'un foyer pour lesquels un récap a réellement été envoyé à un
   * établissement. Sert l'avertissement « déjà envoyé » avant une correction rétroactive.
   * Bornage optionnel `[du, au]` (mois inclus). Lecture seule.
   */
  async moisCommuniques(
    foyerId: string,
    du?: string,
    au?: string,
  ): Promise<string[]> {
    const params = new URLSearchParams();
    if (du !== undefined) params.set('du', du);
    if (au !== undefined) params.set('au', au);
    const suffixe = params.toString() ? `?${params.toString()}` : '';
    return this.appel({
      methode: 'GET',
      chemin:
        `/api/foyers/${encodeURIComponent(foyerId)}/mois-communiques` + suffixe,
      // L'enveloppe `{ mois }` est dépliée par le schéma lui-même : le repli
      // éventuel d'un appelant ne peut ainsi jamais porter sur un objet partiel.
      schema: moisCommuniquesSchema,
    });
  }

  /**
   * GET `/api/moi/notifications?parent=` — inbox in-app d'un parent (liste récente +
   * compteur de non-lus). Le `parentId` est résolu **côté BFF** depuis l'identité
   * (jamais fourni par le navigateur), puis relayé ici comme un `foyer` de la validation.
   */
  async listerInbox(parentId: string): Promise<InboxVue> {
    return this.appel({
      methode: 'GET',
      chemin: `/api/moi/notifications?parent=${encodeURIComponent(parentId)}`,
      schema: inboxSchema,
    });
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
    return this.appel({
      methode: 'POST',
      chemin:
        `/api/moi/notifications/${encodeURIComponent(id)}/lu` +
        `?parent=${encodeURIComponent(parentId)}`,
      schema: notificationInAppSchema,
    });
  }

  /**
   * POST `/api/envois/etablissement` — envoie réellement le récap **agrégé par
   * établissement** au service (idempotent sur `(foyer, semaine, établissement)`).
   *
   * `corpsEdite` (optionnel) : objet + corps (texte brut) relus/édités par le parent
   * dans l'app. Fourni, il est transmis au service qui l'envoie/journalise tel quel
   * (après échappement HTML) ; absent, le service régénère le corps depuis le delta.
   */
  async envoyerRecapEtablissement(
    foyerId: string,
    semaineIso: string,
    etablissementId: string,
    corpsEdite?: { sujet: string; corps: string },
  ): Promise<EnvoiEtablissementResultat> {
    return this.appel({
      methode: 'POST',
      chemin: '/api/envois/etablissement',
      corps: { foyerId, semaineIso, etablissementId, ...corpsEdite },
      schema: envoiEtablissementResultatSchema,
    });
  }
}
