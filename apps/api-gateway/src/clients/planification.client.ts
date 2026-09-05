import { randomUUID } from 'node:crypto';
import { Injectable, Logger } from '@nestjs/common';
import { z, type ZodType } from 'zod';
import { MODES_CONTRAT } from '@creche-planner/contracts-kernel';
import { loadConfig } from '../config.js';
import {
  CircuitBreaker,
  type OptionsResilience,
} from '@creche-planner/resilience';
import { appelResilient, type MethodeHttp } from './appel-resilient.js';

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
  /**
   * Première année d'inscription à l'association ABCM (lot 4a). Optionnel,
   * contrats ABCM uniquement — le service élimine la clé pour CRECHE_PSU.
   */
  readonly premiereInscription?: boolean;
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
  /**
   * Première année d'inscription ABCM (lot 4a). Tolérant à l'absence
   * (`nullish`) : rétro-compat avec un provider pas encore à niveau — le
   * schéma objet (strip) doit sinon le CONSERVER dans les réponses relayées.
   */
  premiereInscription: z.boolean().nullish(),
});

export type ContratVue = z.infer<typeof contratVueSchema>;

/**
 * Corps d'un **avenant** (SFD 30 lot 4) : paramètres versionnés + date d'effet.
 * Union discriminée par `mode` côté service ; la gateway relaie la forme validée
 * a minima (`creerAvenantSchema` BFF).
 */
export type SaisieAvenant = Readonly<Record<string, unknown>>;

/** Corps d'une **correction** de version : paramètres versionnés, sans date. */
export type SaisieCorrectionVersion = Readonly<Record<string, unknown>>;

/**
 * Vue d'une **version** d'un contrat (historique, SFD 30 lot 4) renvoyée par
 * `svc-planification` : paramètres versionnés + période dérivée + traçabilité.
 */
const contratVersionVueSchema = z
  .object({
    id: z.string(),
    contratId: z.string(),
    mode: z.string(),
    dateEffet: z.string(),
    du: z.string(),
    au: z.string().nullable(),
    heuresAnnuellesContractualisees: z.number().nullable(),
    nbMensualites: z.number().nullable(),
    saisiLe: z.string(),
    motif: z.string().nullable(),
  })
  .passthrough(); // semaineType / semaineAbcm relayés tels quels

export type ContratVersionVue = z.infer<typeof contratVersionVueSchema>;

/** Réponse de l'aperçu d'impact d'une version : les mois à recalculer. */
const impactVersionSchema = z.object({
  versionId: z.string(),
  moisCouverts: z.array(z.string()),
});

export type ImpactVersion = z.infer<typeof impactVersionSchema>;

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
        mode: z.enum(MODES_CONTRAT),
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
  /**
   * Zone de vacances scolaires (SFD 31) — `null` = pas de calendrier scolaire.
   *
   * `nullish` **en entrée** par tolérance (un provider pas encore à niveau ne doit
   * pas faire échouer la lecture, patron de `premiereInscription`), mais **normalisé
   * en sortie** : le document OpenAPI déclare ces deux champs *requis*, et le type
   * web en est généré. Relayer un `undefined` rendrait un 200 qui viole le contrat
   * de la gateway elle-même, sans qu'aucune erreur ne le dise.
   */
  zoneScolaire: z
    .enum(['A', 'B', 'C'])
    .nullish()
    .transform((v) => v ?? null),
  /** Régime de fériés **actuellement connu**, `FR` à défaut (D7). */
  regimeFeries: z
    .enum(['FR', 'FR_ALSACE_MOSELLE'])
    .nullish()
    .transform((v) => v ?? 'FR'),
});

export type EtablissementVue = z.infer<typeof etablissementVueSchema>;

/** Corps de création/édition d'un établissement, relayé tel quel (validé en amont). */
export type SaisieEtablissement = Readonly<Record<string, unknown>>;

/**
 * ## Calendrier d'ouverture (SFD 31, lot 2) — le contrat **gelé**
 *
 * ⚠️ La forme de `calendrierResoluSchema` ne bougera plus : le plan 33 la
 * consommera par client REST inter-services **sans pact**, donc sans porte qui
 * sonne si elle change. Les schémas ci-dessous sont **stricts sur ce qui compte**
 * (les quatre clés de la réponse, les quatre du jour résolu) et volontairement
 * tolérants ailleurs — un `z.object` strippe ce qu'il ne connaît pas, et c'est
 * précisément ainsi qu'un champ ajouté en amont disparaît en silence (`LE-48`).
 * `aLaDate` est donc listé ici **explicitement**, à la même place que dans la
 * requête, pour que son absence se voie en revue.
 */
const jourResoluSchema = z.object({
  jour: z.string(),
  contexte: z.enum(['PERIODE_SCOLAIRE', 'VACANCES', 'FERIE', 'FERMETURE']),
  libelle: z.string(),
  servicesOuverts: z.array(z.string()),
});

const calendrierResoluSchema = z.object({
  du: z.string(),
  au: z.string(),
  /** Instant de connaissance **réellement employé** (echo du défaut si omis). */
  aLaDate: z.string(),
  jours: z.array(jourResoluSchema),
});

export type CalendrierResoluVue = z.infer<typeof calendrierResoluSchema>;

const recurrenceVueSchema = z.object({
  id: z.string(),
  regime: z.enum(['SCOLAIRE', 'VACANCES']),
  jourSemaine: z.string(),
  services: z.array(z.string()),
  connuDepuis: z.string(),
});

const recurrencesSchema = z.object({
  aLaDate: z.string(),
  recurrences: z.array(recurrenceVueSchema),
});

export type RecurrencesVue = z.infer<typeof recurrencesSchema>;

const periodeVueSchema = z.object({
  id: z.string(),
  type: z.enum(['PERIODE_SCOLAIRE', 'VACANCES', 'FERMETURE_ANNUELLE']),
  libelle: z.string(),
  du: z.string(),
  au: z.string(),
  source: z.enum(['IMPORT', 'MANUEL']),
  anneeScolaire: z.string().nullable(),
  connuDepuis: z.string(),
});

const periodesSchema = z.object({
  aLaDate: z.string(),
  periodes: z.array(periodeVueSchema),
});

export type PeriodeVue = z.infer<typeof periodeVueSchema>;
export type PeriodesVue = z.infer<typeof periodesSchema>;

const exceptionVueSchema = z.object({
  id: z.string(),
  jour: z.string(),
  type: z.enum(['FERMETURE', 'OUVERTURE', 'JOURNEE_PEDAGOGIQUE', 'PONT']),
  libelle: z.string(),
  services: z.array(z.string()).nullable(),
  connuDepuis: z.string(),
});

const exceptionsSchema = z.object({
  aLaDate: z.string(),
  exceptions: z.array(exceptionVueSchema),
});

export type ExceptionVue = z.infer<typeof exceptionVueSchema>;
export type ExceptionsVue = z.infer<typeof exceptionsSchema>;

/**
 * Réponse de `POST …/calendrier/import` (SFD 31, US-31-01).
 *
 * Un COMPTE RENDU, pas la liste des périodes : l'écran relit ensuite
 * `GET …/calendrier/periodes`, seule source de vérité de ce qui est en base. Un
 * import qui renverrait les périodes créerait une seconde vue de la même chose,
 * qui divergerait le jour où une retouche s'intercale.
 */
const importCalendrierSchema = z.object({
  anneeScolaire: z.string(),
  zoneScolaire: z.enum(['A', 'B', 'C']),
  /** Périodes posées par cet import. */
  importees: z.number().int().nonnegative(),
  /** Périodes d'un import précédent, closes par celui-ci (0 au premier import). */
  remplacees: z.number().int().nonnegative(),
});

export type ImportCalendrierVue = z.infer<typeof importCalendrierSchema>;

/** Corps d'écriture du calendrier, relayé tel quel (validé à la frontière BFF). */
export type SaisieCalendrier = Readonly<Record<string, unknown>>;

/**
 * Réponse `GET /api/contrats/:id/plannings/:mois` : la saisie enregistrée du
 * mois (forme libre, relayée telle quelle) ou `null` si aucune saisie.
 */
const lirePlanningReponseSchema = z.object({
  saisie: z.record(z.string(), z.unknown()).nullable(),
});

export type LirePlanningReponse = z.infer<typeof lirePlanningReponseSchema>;

/**
 * Une ligne d'export de portabilité : objet libre. Cf. la note du même schéma
 * dans `foyer.client.ts` — la passerelle contracte la **présence des sections**,
 * pas les colonnes.
 */
const ligneExportSchema = z.record(z.string(), z.unknown());

const exportPlanificationSchema = z.object({
  contrats: z.array(ligneExportSchema),
  etablissements: z.array(ligneExportSchema),
});

/** Part `svc-planification` de l'export de portabilité (lot 3, `AM-35`). */
export type ExportPlanificationVue = z.infer<typeof exportPlanificationSchema>;

const OPTIONS: OptionsResilience = {
  timeoutMs: 2000,
  retries: 1,
  delaiEntreEssaisMs: 200,
};

/** Budget élargi de l'export (contrats × avenants × plannings) — cf. `foyer.client.ts`. */
const OPTIONS_EXPORT: OptionsResilience = {
  timeoutMs: 8000,
  retries: 0,
  delaiEntreEssaisMs: 0,
};

/**
 * Client REST résilient vers `svc-planification` (port 3004). Sur le chemin
 * critique du BFF : timeout + retry borné + circuit-breaker, avec
 * **propagation** des erreurs. Le squelette commun par endpoint (fetch + garde
 * `ok` + parse Zod) est factorisé dans `appelResilient` ; chaque méthode ne
 * déclare plus que sa méthode HTTP, son chemin, son corps éventuel et le schéma
 * de sa réponse.
 */
@Injectable()
export class PlanificationClient {
  private readonly logger = new Logger(PlanificationClient.name);
  private readonly breaker = new CircuitBreaker();

  /** Appel résilient vers `svc-planification`, `chemin` relatif à la base configurée. */
  private appel<T>(config: {
    methode: MethodeHttp;
    chemin: string;
    corps?: unknown;
    schema: ZodType<T>;
    options?: OptionsResilience;
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
    options?: OptionsResilience;
  }): Promise<T | void> {
    const commun = {
      service: 'svc-planification',
      logger: this.logger,
      breaker: this.breaker,
      options: config.options ?? OPTIONS,
      methode: config.methode,
      url: `${loadConfig().planificationUrl}${config.chemin}`,
      corps: config.corps,
    };
    return config.schema === undefined
      ? appelResilient(commun)
      : appelResilient({ ...commun, schema: config.schema });
  }

  /**
   * GET `/api/foyers/:foyerId/export` — part `svc-planification` de l'export de
   * portabilité (contrats, avenants, corrections, plannings, établissements).
   */
  async exporter(foyerId: string): Promise<ExportPlanificationVue> {
    return this.appel({
      methode: 'GET',
      chemin: `/api/foyers/${encodeURIComponent(foyerId)}/export`,
      schema: exportPlanificationSchema,
      options: OPTIONS_EXPORT,
    });
  }

  /** POST `/api/contrats` — crée un contrat. */
  async creerContrat(saisie: SaisieContrat): Promise<ContratVue> {
    // Clé d'idempotence générée AVANT l'appel : les deux tentatives d'un même
    // POST (retry sur réponse lente) partagent cet `id`, dédupliqué par PK
    // `contrat.id` côté service (`onConflictDoNothing`) → jamais de doublon.
    return this.appel({
      methode: 'POST',
      chemin: '/api/contrats',
      corps: { id: randomUUID(), ...saisie },
      schema: contratVueSchema,
    });
  }

  /**
   * GET `/api/contrats/:id` — cœur d'un contrat (dont son `foyerId`). Sert la
   * **résolution contrat → foyer** du guard d'appartenance (PR7) : les routes
   * `/contrats/:id/...` ne portent qu'un `contratId`. 404 → erreur propagée.
   */
  async contrat(id: string): Promise<ContratVue> {
    return this.appel({
      methode: 'GET',
      chemin: `/api/contrats/${encodeURIComponent(id)}`,
      schema: contratVueSchema,
    });
  }

  /** GET `/api/contrats?foyer=` — liste les contrats d'un foyer (config incluse). */
  async listerContrats(foyerId: string): Promise<ContratVue[]> {
    return this.appel({
      methode: 'GET',
      chemin: `/api/contrats?foyer=${encodeURIComponent(foyerId)}`,
      // `passthrough` : on conserve la config mode-spécifique (semaineType,
      // semaineAbcm, heures, nbMensualités) relayée telle quelle au front.
      schema: z.array(contratVueSchema.passthrough()),
    });
  }

  /**
   * PUT `/api/contrats/:id/version-courante` — corrige les **paramètres versionnés
   * courants** d'un contrat (SFD 30 lot 4). Remplace l'ancien `PUT /contrats/:id`
   * (supprimé côté service, avec sa cascade destructive sur `planning_mois`) : le
   * corps reste le contrat complet, mais seuls les champs versionnés sont écrits
   * et les plannings saisis **survivent**.
   */
  async modifierContrat(
    id: string,
    saisie: SaisieContrat,
  ): Promise<ContratVue> {
    return this.appel({
      methode: 'PUT',
      chemin: `/api/contrats/${encodeURIComponent(id)}/version-courante`,
      corps: saisie,
      schema: contratVueSchema,
    });
  }

  /** POST `/api/contrats/:id/versions` — crée un **avenant** (201 attendu). */
  async creerAvenant(id: string, saisie: SaisieAvenant): Promise<ContratVue> {
    return this.appel({
      methode: 'POST',
      chemin: `/api/contrats/${encodeURIComponent(id)}/versions`,
      corps: saisie,
      schema: contratVueSchema,
    });
  }

  /** GET `/api/contrats/:id/versions` — historique des versions d'un contrat. */
  async listerVersions(id: string): Promise<ContratVersionVue[]> {
    return this.appel({
      methode: 'GET',
      chemin: `/api/contrats/${encodeURIComponent(id)}/versions`,
      schema: z.array(contratVersionVueSchema),
    });
  }

  /**
   * GET `/api/contrats/:id/versions/:versionId/impact` — aperçu d'impact (mois
   * recalculés) d'une version, requis avant correction rétroactive.
   */
  async apercuImpactVersion(
    id: string,
    versionId: string,
  ): Promise<ImpactVersion> {
    return this.appel({
      methode: 'GET',
      chemin:
        `/api/contrats/${encodeURIComponent(id)}` +
        `/versions/${encodeURIComponent(versionId)}/impact`,
      schema: impactVersionSchema,
    });
  }

  /**
   * PUT `/api/contrats/:id/versions/:versionId` — **corrige** une version
   * existante (geste rétroactif tracé côté service, `correction_journal`).
   */
  async corrigerVersion(
    id: string,
    versionId: string,
    saisie: SaisieCorrectionVersion,
  ): Promise<ContratVue> {
    return this.appel({
      methode: 'PUT',
      chemin:
        `/api/contrats/${encodeURIComponent(id)}` +
        `/versions/${encodeURIComponent(versionId)}`,
      corps: saisie,
      schema: contratVueSchema,
    });
  }

  /** DELETE `/api/contrats/:id` — supprime un contrat (204 attendu). */
  async supprimerContrat(id: string): Promise<void> {
    await this.appel({
      methode: 'DELETE',
      chemin: `/api/contrats/${encodeURIComponent(id)}`,
    });
  }

  /** PUT `/api/contrats/:id/plannings/:mois` — écrit un planning (204 attendu). */
  async ecrirePlanning(
    contratId: string,
    mois: string,
    simule: boolean,
    corps: SaisiePlanning,
  ): Promise<void> {
    await this.appel({
      methode: 'PUT',
      chemin:
        `/api/contrats/${encodeURIComponent(contratId)}` +
        `/plannings/${encodeURIComponent(mois)}?simule=${simule ? 'true' : 'false'}`,
      corps,
    });
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
    await this.appel({
      methode: 'PUT',
      chemin:
        `/api/contrats/${encodeURIComponent(contratId)}` +
        `/plannings/semaine/${encodeURIComponent(semaineIso)}?simule=${simule ? 'true' : 'false'}`,
      corps,
    });
  }

  /** GET `/api/contrats/:id/plannings/:mois` — saisie enregistrée d'un mois. */
  async lirePlanning(
    contratId: string,
    mois: string,
    simule: boolean,
  ): Promise<LirePlanningReponse> {
    return this.appel({
      methode: 'GET',
      chemin:
        `/api/contrats/${encodeURIComponent(contratId)}` +
        `/plannings/${encodeURIComponent(mois)}?simule=${simule ? 'true' : 'false'}`,
      schema: lirePlanningReponseSchema,
    });
  }

  /** GET `/api/etablissements?foyer=` — établissements (entité libre) d'un foyer. */
  async listerEtablissements(foyerId: string): Promise<EtablissementVue[]> {
    return this.appel({
      methode: 'GET',
      chemin: `/api/etablissements?foyer=${encodeURIComponent(foyerId)}`,
      schema: z.array(etablissementVueSchema),
    });
  }

  /** POST `/api/etablissements?foyer=` — crée un établissement (201). */
  async creerEtablissement(
    foyerId: string,
    saisie: SaisieEtablissement,
  ): Promise<EtablissementVue> {
    // Même clé d'idempotence que `creerContrat` : l'`id` généré ici est partagé
    // par les deux tentatives d'un retry → dédup par PK `etablissement.id`.
    return this.appel({
      methode: 'POST',
      chemin: `/api/etablissements?foyer=${encodeURIComponent(foyerId)}`,
      corps: { id: randomUUID(), ...saisie },
      schema: etablissementVueSchema,
    });
  }

  /** PUT `/api/etablissements/:id` — modifie un établissement. */
  async modifierEtablissement(
    id: string,
    saisie: SaisieEtablissement,
  ): Promise<EtablissementVue> {
    return this.appel({
      methode: 'PUT',
      chemin: `/api/etablissements/${encodeURIComponent(id)}`,
      corps: saisie,
      schema: etablissementVueSchema,
    });
  }

  /** DELETE `/api/etablissements/:id` — supprime un établissement (204 ; 409 si rattaché). */
  async supprimerEtablissement(id: string): Promise<void> {
    await this.appel({
      methode: 'DELETE',
      chemin: `/api/etablissements/${encodeURIComponent(id)}`,
    });
  }

  /**
   * GET `/api/etablissements/:id/calendrier?du=&au=&aLaDate=` — jours résolus.
   *
   * `aLaDate` n'est ajouté à la query **que s'il est fourni** : la sémantique du
   * contrat est « omis = maintenant », et transmettre un `aLaDate=` vide ferait
   * échouer la validation amont au lieu d'exprimer le défaut.
   */
  async lireCalendrier(
    etablissementId: string,
    du: string,
    au: string,
    aLaDate?: string,
  ): Promise<CalendrierResoluVue> {
    return this.appel({
      methode: 'GET',
      chemin:
        `/api/etablissements/${encodeURIComponent(etablissementId)}/calendrier` +
        `?du=${encodeURIComponent(du)}&au=${encodeURIComponent(au)}` +
        this.suffixeALaDate(aLaDate),
      schema: calendrierResoluSchema,
    });
  }

  /** GET `…/calendrier/recurrences` — récurrence hebdomadaire connue à `aLaDate`. */
  async lireRecurrencesCalendrier(
    etablissementId: string,
    aLaDate?: string,
  ): Promise<RecurrencesVue> {
    return this.appel({
      methode: 'GET',
      chemin:
        `/api/etablissements/${encodeURIComponent(etablissementId)}` +
        `/calendrier/recurrences${this.premierParamALaDate(aLaDate)}`,
      schema: recurrencesSchema,
    });
  }

  /** PUT `…/calendrier/recurrences` — remplace la semaine type (append-only). */
  async remplacerRecurrencesCalendrier(
    etablissementId: string,
    saisie: SaisieCalendrier,
  ): Promise<RecurrencesVue> {
    return this.appel({
      methode: 'PUT',
      chemin:
        `/api/etablissements/${encodeURIComponent(etablissementId)}` +
        `/calendrier/recurrences`,
      corps: saisie,
      schema: recurrencesSchema,
    });
  }

  /** GET `…/calendrier/periodes` — périodes connues à `aLaDate`. */
  async lirePeriodesCalendrier(
    etablissementId: string,
    aLaDate?: string,
  ): Promise<PeriodesVue> {
    return this.appel({
      methode: 'GET',
      chemin:
        `/api/etablissements/${encodeURIComponent(etablissementId)}` +
        `/calendrier/periodes${this.premierParamALaDate(aLaDate)}`,
      schema: periodesSchema,
    });
  }

  /** POST `…/calendrier/periodes` — ouvre une période saisie manuellement (201). */
  async saisirPeriodeCalendrier(
    etablissementId: string,
    saisie: SaisieCalendrier,
  ): Promise<PeriodeVue> {
    return this.appel({
      methode: 'POST',
      chemin:
        `/api/etablissements/${encodeURIComponent(etablissementId)}` +
        `/calendrier/periodes`,
      corps: saisie,
      schema: periodeVueSchema,
    });
  }

  /** POST `…/calendrier/import` — importe une année scolaire (200, compte rendu). */
  async importerCalendrier(
    etablissementId: string,
    anneeScolaire: string,
  ): Promise<ImportCalendrierVue> {
    return this.appel({
      methode: 'POST',
      chemin:
        `/api/etablissements/${encodeURIComponent(etablissementId)}` +
        `/calendrier/import`,
      corps: { anneeScolaire },
      schema: importCalendrierSchema,
    });
  }

  /** PUT `…/calendrier/periodes/:periodeId` — retouche (clôt puis rouvre). */
  async retoucherPeriodeCalendrier(
    etablissementId: string,
    periodeId: string,
    saisie: SaisieCalendrier,
  ): Promise<PeriodeVue> {
    return this.appel({
      methode: 'PUT',
      chemin:
        `/api/etablissements/${encodeURIComponent(etablissementId)}` +
        `/calendrier/periodes/${encodeURIComponent(periodeId)}`,
      corps: saisie,
      schema: periodeVueSchema,
    });
  }

  /** DELETE `…/calendrier/periodes/:periodeId` — clôt la période (204). */
  async clorePeriodeCalendrier(
    etablissementId: string,
    periodeId: string,
  ): Promise<void> {
    await this.appel({
      methode: 'DELETE',
      chemin:
        `/api/etablissements/${encodeURIComponent(etablissementId)}` +
        `/calendrier/periodes/${encodeURIComponent(periodeId)}`,
    });
  }

  /** GET `…/calendrier/exceptions` — exceptions connues à `aLaDate`. */
  async lireExceptionsCalendrier(
    etablissementId: string,
    aLaDate?: string,
  ): Promise<ExceptionsVue> {
    return this.appel({
      methode: 'GET',
      chemin:
        `/api/etablissements/${encodeURIComponent(etablissementId)}` +
        `/calendrier/exceptions${this.premierParamALaDate(aLaDate)}`,
      schema: exceptionsSchema,
    });
  }

  /** POST `…/calendrier/exceptions` — pose une exception, upsert par jour (201). */
  async poserExceptionCalendrier(
    etablissementId: string,
    saisie: SaisieCalendrier,
  ): Promise<ExceptionVue> {
    return this.appel({
      methode: 'POST',
      chemin:
        `/api/etablissements/${encodeURIComponent(etablissementId)}` +
        `/calendrier/exceptions`,
      corps: saisie,
      schema: exceptionVueSchema,
    });
  }

  /** DELETE `…/calendrier/exceptions/:exceptionId` — clôt l'exception (204). */
  async cloreExceptionCalendrier(
    etablissementId: string,
    exceptionId: string,
  ): Promise<void> {
    await this.appel({
      methode: 'DELETE',
      chemin:
        `/api/etablissements/${encodeURIComponent(etablissementId)}` +
        `/calendrier/exceptions/${encodeURIComponent(exceptionId)}`,
    });
  }

  /** `&aLaDate=…` si fourni, chaîne vide sinon (le défaut est « maintenant »). */
  private suffixeALaDate(aLaDate: string | undefined): string {
    return aLaDate === undefined
      ? ''
      : `&aLaDate=${encodeURIComponent(aLaDate)}`;
  }

  /** Idem, mais en **premier** paramètre de la query (`?` au lieu de `&`). */
  private premierParamALaDate(aLaDate: string | undefined): string {
    return aLaDate === undefined
      ? ''
      : `?aLaDate=${encodeURIComponent(aLaDate)}`;
  }

  /** GET `/api/prestations` — prestations générées d'un (contrat, mois). */
  async prestations(
    contratId: string,
    mois: string,
    simule: boolean,
  ): Promise<PrestationsReponse> {
    return this.appel({
      methode: 'GET',
      chemin:
        `/api/prestations?contrat=${encodeURIComponent(contratId)}` +
        `&mois=${encodeURIComponent(mois)}&simule=${simule ? 'true' : 'false'}`,
      schema: prestationsReponseSchema,
    });
  }
}
