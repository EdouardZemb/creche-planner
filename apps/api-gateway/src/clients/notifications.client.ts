import { Injectable, Logger } from '@nestjs/common';
import { z } from 'zod';
import { loadConfig } from '../config.js';
import {
  CircuitBreaker,
  executerResilient,
  fetchAvecTimeout,
  type OptionsResilience,
} from './resilience.js';

/** Règle de préavis d'un établissement (union discriminée par `type`). */
const preavisRegleSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('JOURS_OUVRES'), valeur: z.number() }),
  z.object({
    type: z.literal('JOUR_HEURE'),
    jour: z.string(),
    heure: z.string(),
  }),
]);

/** Vue lecture d'un établissement renvoyée par `svc-notifications`. */
const etablissementVueSchema = z.object({
  cle: z.enum(['CRECHE_HIRONDELLES', 'ABCM']),
  libelle: z.string(),
  emailService: z.string(),
  preavisRegle: preavisRegleSchema,
  actif: z.boolean(),
});

export type EtablissementVue = z.infer<typeof etablissementVueSchema>;

/** Corps d'upsert relayé tel quel au service (validé en amont par la gateway). */
export type SaisieEtablissement = Readonly<Record<string, unknown>>;

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

/** Brouillon régénérable du mail au service (Lot 6). */
const brouillonSchema = z.object({
  contratId: z.string(),
  semaineIso: z.string(),
  etablissementCle: z.enum(['CRECHE_HIRONDELLES', 'ABCM']),
  etablissementLibelle: z.string(),
  destinataire: z.string(),
  sujet: z.string(),
  corps: z.string(),
  texte: z.string(),
  deltaModifs: deltaModifsSchema,
  dryRun: z.boolean(),
});

export type BrouillonVue = z.infer<typeof brouillonSchema>;

/** Statut d'un envoi de récap au service. */
const statutEnvoiSchema = z.enum(['EN_COURS', 'ENVOYE', 'ECHEC', 'DRY_RUN']);

/** Résultat d'un envoi (Lot 6) : issue réelle de l'action sortante. */
const envoiResultatSchema = z.object({
  contratId: z.string(),
  semaineIso: z.string(),
  etablissementCle: z.enum(['CRECHE_HIRONDELLES', 'ABCM']),
  destinataire: z.string(),
  statut: statutEnvoiSchema,
  messageId: z.string().nullable(),
  erreur: z.string().nullable(),
  envoyeLe: z.string().nullable(),
});

export type EnvoiResultat = z.infer<typeof envoiResultatSchema>;

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

  /** GET `/api/etablissements` — liste les établissements destinataires. */
  async listerEtablissements(): Promise<EtablissementVue[]> {
    const base = loadConfig().notificationsUrl;
    const url = `${base}/api/etablissements`;
    this.logger.debug(`GET ${url}`);
    return executerResilient(
      'svc-notifications',
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

  /** PUT `/api/etablissements/:cle` — upsert d'un établissement par clé. */
  async upsertEtablissement(
    cle: string,
    saisie: SaisieEtablissement,
  ): Promise<EtablissementVue> {
    const base = loadConfig().notificationsUrl;
    const url = `${base}/api/etablissements/${encodeURIComponent(cle)}`;
    this.logger.debug(`PUT ${url}`);
    return executerResilient(
      'svc-notifications',
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

  /** GET `/api/validations/:contratId/:semaineIso/brouillon` — régénère le brouillon. */
  async lireBrouillon(
    contratId: string,
    semaineIso: string,
  ): Promise<BrouillonVue> {
    const base = loadConfig().notificationsUrl;
    const url =
      `${base}/api/validations/${encodeURIComponent(contratId)}` +
      `/${encodeURIComponent(semaineIso)}/brouillon`;
    this.logger.debug(`GET ${url}`);
    return executerResilient(
      'svc-notifications',
      async () => {
        const reponse = await fetchAvecTimeout(url, OPTIONS.timeoutMs);
        if (!reponse.ok) {
          throw new Error('HTTP ' + reponse.status);
        }
        return brouillonSchema.parse(await reponse.json());
      },
      this.breaker,
      OPTIONS,
    );
  }

  /** POST `/api/envois` — envoie réellement le récap au service (idempotent). */
  async envoyerRecap(
    contratId: string,
    semaineIso: string,
  ): Promise<EnvoiResultat> {
    const base = loadConfig().notificationsUrl;
    const url = `${base}/api/envois`;
    this.logger.debug(`POST ${url}`);
    return executerResilient(
      'svc-notifications',
      async () => {
        const reponse = await fetchAvecTimeout(url, OPTIONS.timeoutMs, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ contratId, semaineIso }),
        });
        if (!reponse.ok) {
          throw new Error('HTTP ' + reponse.status);
        }
        return envoiResultatSchema.parse(await reponse.json());
      },
      this.breaker,
      OPTIONS,
    );
  }
}
