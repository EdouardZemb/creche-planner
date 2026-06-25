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
}
