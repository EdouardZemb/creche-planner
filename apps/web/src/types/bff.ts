// Types du contrat BFF (api-gateway `/api/v1`) consommés par le front.
//
// DEC-03 / ADR-0004 (décision 3) + AQ-10 (doc 27) : la **source de vérité** est le
// document OpenAPI publié par la gateway (`gatewayOpenApiDocument`, exporté par
// `@creche-planner/contracts-kernel`, servi par `GET /api/openapi.json`). Les vues
// de lecture et le corps de création de foyer ne sont **plus réécrits à la main** :
// ils sont **générés** du contrat par openapi-typescript
// (`api/openapi-types.gen.ts`, alias d'accès dans `api/openapi-types.ts`).
// Toute divergence schéma gateway ↔ usage front est donc une **erreur
// `web:typecheck`**, et un contrat modifié sans régénération échoue en CI
// (job `openapi-types-drift`).
//
// Restent typés à la main (avec justification) les formes que le contrat laisse
// volontairement **ouvertes** (`additionalProperties: true`) ou qui relèvent de
// svc-planification et ne transitent pas par un schéma OpenAPI nommé :
// la semaine-type, les corps de contrat discriminés par mode et le corps de
// planning. Le contrat gateway ne les décrit pas → rien à dériver.

import type {
  SchemaComposant,
  ReponseJson,
  CorpsRequeteJson,
} from '../api/openapi-types';

// ---- Vues de lecture : DÉRIVÉES du contrat (montants en CENTIMES) ----------

/** Vue projetée d'un foyer — dérivée de `components.schemas.FoyerVue`. */
export type FoyerVue = SchemaComposant<'FoyerVue'>;

/** Vue projetée d'un enfant — dérivée de `components.schemas.EnfantVue`. */
export type EnfantVue = SchemaComposant<'EnfantVue'>;

/** Vue projetée d'un parent — dérivée de `components.schemas.ParentVue`. */
export type ParentVue = SchemaComposant<'ParentVue'>;

/** Identité courante + droits (admin, foyers autorisés) — dérivée de `components.schemas.MoiVue`. */
export type MoiVue = SchemaComposant<'MoiVue'>;

/** Vue projetée d'un contrat — dérivée de `components.schemas.ContratVue`. */
export type ContratVue = SchemaComposant<'ContratVue'>;

/** Ligne de coût — dérivée de `components.schemas.Ligne`. */
export type Ligne = SchemaComposant<'Ligne'>;

/** Coût mensuel consolidé — dérivé de la réponse 200 de `GET /api/v1/couts`. */
export type CoutMoisVue = ReponseJson<'/api/v1/couts', 'get', 200>;

/** Une prestation au sein d'un coût mensuel — dérivée du schéma imbriqué de `CoutMoisVue`. */
export type PrestationCout = CoutMoisVue['prestations'][number];

/** Coût annuel consolidé — dérivé de la réponse 200 de `GET /api/v1/couts/annuel`. */
export type CoutAnnuelVue = ReponseJson<'/api/v1/couts/annuel', 'get', 200>;

/** Dossier foyer (foyer + enfants) — dérivé de la réponse 201 de `POST /api/v1/foyers`. */
export type DossierFoyerVue = ReponseJson<'/api/v1/foyers', 'post', 201>;

/** Règle de préavis d'un établissement — dérivée de `components.schemas.PreavisRegle`. */
export type PreavisRegle = SchemaComposant<'PreavisRegle'>;

/** Établissement destinataire — dérivé de `components.schemas.EtablissementVue`. */
export type EtablissementVue = SchemaComposant<'EtablissementVue'>;

/** Clé d'un établissement — dérivée du champ `cle` d'`EtablissementVue`. */
export type CleEtablissement = EtablissementVue['cle'];

/** Corps d'upsert d'un établissement — dérivé du requestBody de `PUT /api/v1/etablissements/{cle}`. */
export type MajEtablissement = CorpsRequeteJson<
  '/api/v1/etablissements/{cle}',
  'put'
>;

// ---- Saisies d'écriture dérivables : corps de création de foyer ------------

/** Corps de création d'un foyer (EUROS) — dérivé du requestBody de `POST /api/v1/foyers`. */
export type CreerDossierFoyer = CorpsRequeteJson<'/api/v1/foyers', 'post'>;

/** Un enfant à créer — dérivé du sous-schéma `enfants[]` de `CreerDossierFoyer`. */
export type CreerEnfant = CreerDossierFoyer['enfants'][number];

/** Un parent à rattacher à la création — dérivé du sous-schéma `parents[]` de `CreerDossierFoyer`. */
export type CreerParent = NonNullable<CreerDossierFoyer['parents']>[number];

// ---- Énumérations dérivées du contrat --------------------------------------

/**
 * Mode de garde — dérivé de l'`enum` `mode` du requestBody de `POST /api/v1/contrats`.
 * (Le contrat décrit l'enum même si le corps complet est `additionalProperties: true`.)
 */
export type Mode = CorpsRequeteJson<'/api/v1/contrats', 'post'>['mode'];

// ---- Formes laissées à la main (le contrat ne les décrit pas) --------------
//
// Justification : les routes `POST /api/v1/contrats` et
// `PUT /api/v1/contrats/{id}/plannings/{mois}` exposent un schéma
// `additionalProperties: true` (passthrough intégral côté gateway). Les champs
// ci-dessous relèvent de svc-planification et ne sont pas nommés dans l'OpenAPI :
// il n'existe donc rien à dériver et ces types restent la spécification locale du
// front. `JourSemaine` est de même une convention de svc-planification.

export type JourSemaine =
  | 'LUNDI'
  | 'MARDI'
  | 'MERCREDI'
  | 'JEUDI'
  | 'VENDREDI'
  | 'SAMEDI'
  | 'DIMANCHE';

// Contrats (union discriminée par mode — passthrough intégral du BFF).
export interface PlageHoraire {
  debutHeures: number; // 0-23
  debutMinutes: number; // 0-59
  finHeures: number; // 0-24
  finMinutes: number; // 0-59
}

export type SemaineTypeCreche = Partial<Record<JourSemaine, PlageHoraire[]>>;

export interface InscriptionsJour {
  cantine?: boolean;
  periMatin?: boolean;
  periSoir?: boolean;
}

export type SemaineAbcm = Partial<Record<JourSemaine, InscriptionsJour>>;

export interface CreerContratCreche {
  mode: 'CRECHE_PSU';
  foyerId: string;
  enfant: string;
  valideDu: string;
  valideAu: string | null;
  heuresAnnuellesContractualisees: number;
  nbMensualites: number;
  semaineType: SemaineTypeCreche;
}

export interface CreerContratAbcm {
  mode: 'CANTINE' | 'PERISCOLAIRE' | 'ALSH';
  foyerId: string;
  enfant: string;
  valideDu: string;
  valideAu: string | null;
  semaineAbcm: SemaineAbcm;
}

export type CreerContrat = CreerContratCreche | CreerContratAbcm;

// Écriture de planning (PUT /contrats/:id/plannings/:mois?simule=).
// Crèche : la saisie d'une présence/absence se fait en heures d'arrivée/départ
// (plage horaire) ; la durée déduite/ajoutée en est dérivée côté serveur.
export interface AbsenceCreche extends PlageHoraire {
  date?: string; // YYYY-MM-DD — jour retiré (métadonnée d'affichage/persistance)
  preavisJours: number;
  certificatMaladie: boolean;
}

/** Jour de garde ajouté ponctuellement hors semaine type (crèche → complément). */
export interface JourSupplementaire extends PlageHoraire {
  date: string; // YYYY-MM-DD
}

/** Ajustement ponctuel d'un jour ABCM (surcharge la semaine type pour une date). */
export interface ExceptionAbcm {
  date: string; // YYYY-MM-DD
  cantine?: boolean;
  periMatin?: boolean;
  periSoir?: boolean;
}

export interface JourAlsh {
  date: string; // YYYY-MM-DD
  type: 'COMPLETE' | 'DEMI';
  repas?: boolean;
}

export interface EcrirePlanning {
  complementMinutes?: number; // CRECHE_PSU
  joursSupplementaires?: JourSupplementaire[]; // CRECHE_PSU — jours ajoutés
  absences?: AbsenceCreche[]; // CRECHE_PSU
  pai?: boolean; // CANTINE
  exceptions?: ExceptionAbcm[]; // CANTINE / PERISCOLAIRE — ajustements par jour
  joursAlsh?: JourAlsh[]; // ALSH
}

/**
 * Corps d'une **édition hebdomadaire** : uniquement les catégories datées d'un
 * contrat pour la semaine éditée (les scalaires mensuels `complementMinutes`/`pai`
 * sont hors périmètre, cf. `PUT .../plannings/semaine/:semaineIso`). Le service
 * fusionne ces besoins dans le/les mois recouverts sans écraser le reste.
 */
export interface EcrireSemaineBesoins {
  joursSupplementaires?: JourSupplementaire[];
  absences?: AbsenceCreche[];
  exceptions?: ExceptionAbcm[];
  joursAlsh?: JourAlsh[];
}

/** Réponse de lecture d'une saisie de planning : la saisie stockée ou `null`. */
export interface LirePlanningReponse {
  saisie: EcrirePlanning | null;
}

// ---- Notifications : validation hebdomadaire (Lot 4) -----------------------
//
// Hand-typé (comme la saisie de planning) : les routes BFF
// `/api/v1/notifications/*` ne sont pas décrites dans l'OpenAPI de la gateway —
// il n'y a donc rien à dériver. svc-notifications en est la spécification.

/** Statut de la validation d'une semaine. */
export type StatutNotification =
  | 'A_VALIDER'
  | 'VALIDEE'
  | 'VALIDEE_AVEC_MODIFS';

/**
 * Une semaine à valider (indicateur in-app). Enrichie par le BFF (jointure avec les
 * contrats du foyer) du prénom de l'enfant et du mode de garde, pour distinguer N lignes
 * d'une même semaine dans l'encart. `enfant`/`mode` sont absents si le contrat n'est plus
 * listé côté BFF (l'écran retombe alors sur le libellé de repli « Planning de la … »).
 */
export interface NotificationAValider {
  contratId: string;
  foyerId: string;
  semaineIso: string; // `YYYY-Www`
  statut: StatutNotification;
  notifieeLe: string; // ISO 8601
  enfant?: string; // prénom du contrat (enrichi BFF)
  mode?: string; // mode de garde (chaîne libre ; passer par libelleMode)
}

/** Un jour modifié entre le snapshot de notification et la relecture. */
export interface DeltaJour {
  date: string; // `YYYY-MM-DD`
  avant: unknown;
  apres: unknown;
}

/** Jours modifiés à la validation (forme libre relayée par la gateway). */
export interface DeltaModifs {
  jours: DeltaJour[];
}

/** Résultat d'une validation de semaine. */
export interface ValidationResultat {
  contratId: string;
  semaineIso: string;
  statut: StatutNotification;
  deltaModifs: DeltaModifs | null;
}

// ---- Notifications : vue hebdomadaire consolidée éditable ------------------
//
// Hand-typé : la route BFF `GET /api/v1/notifications/semaine/:foyerId/:semaineIso/
// besoins` n'est pas décrite dans l'OpenAPI de la gateway (agrégation orientée
// écran de svc-planification + svc-notifications) → rien à dériver.

/** Entrées datées d'un jour (mêmes catégories que la saisie mensuelle). */
export interface SaisieJourBesoins {
  joursSupplementaires: JourSupplementaire[];
  absences: AbsenceCreche[];
  exceptions: ExceptionAbcm[];
  joursAlsh: JourAlsh[];
}

/** Besoins d'une semaine : jour `YYYY-MM-DD` → entrées (jours vides omis). */
export type BesoinsSemaine = Record<string, SaisieJourBesoins>;

/** Établissement réel concerné par la semaine (entité libre, `svc-planification`). */
export interface EtablissementConcerne {
  /** Identifiant de l'établissement réel (clé de groupement à l'écran). */
  etablissementId: string;
  libelle: string;
  /** Règle de préavis, `null` si l'établissement ne l'a pas (encore) renseignée. */
  preavisRegle: PreavisRegle | null;
}

/** Un contrat actif de la semaine, avec ses besoins datés et son établissement. */
export interface ContratBesoinsSemaine {
  contratId: string;
  enfant: string;
  mode: Mode;
  /** Lien explicite vers l'établissement réel (P3), `null` si non rattaché. */
  etablissementId: string | null;
  besoins: BesoinsSemaine;
  /**
   * Planning de BASE (semaine-type) du contrat, fourni selon le mode : permet
   * d'afficher les horaires planifiés d'un jour normal sans ouvrir la saisie. Les
   * entrées datées de `besoins` restent les exceptions qui priment sur cette base.
   */
  semaineType?: SemaineTypeCreche;
  semaineAbcm?: SemaineAbcm;
}

/**
 * Vue consolidée d'une semaine éditable du foyer : les 7 jours, les établissements
 * concernés et les contrats actifs avec leurs besoins, groupables à l'écran par
 * enfant → établissement/mode. Ouverte depuis une notification A_VALIDER.
 */
export interface SemaineBesoins {
  semaineIso: string; // `YYYY-Www`
  jours: string[]; // 7 jours `YYYY-MM-DD`, lundi → dimanche
  etablissements: EtablissementConcerne[];
  contrats: ContratBesoinsSemaine[];
}

// ---- Notifications : mail au service AGRÉGÉ par établissement (Phase 4) -----
//
// Granularité de l'édition hebdo : un seul mail par établissement regroupant tous
// les enfants du foyer dont la semaine a été validée avec modifications (remplace
// l'envoi par-contrat du Lot 6).

/** Un enfant du foyer concerné par le récap d'un établissement (diff figé du Lot 4). */
export interface EnfantBrouillon {
  contratId: string;
  enfant: string;
  deltaModifs: DeltaModifs;
}

/**
 * Brouillon régénérable du mail **agrégé par établissement** adressé au service
 * (crèche / école ABCM) après relecture humaine. `dryRun` indique qu'un envoi réel
 * serait neutralisé (bac à sable ou destinataire hors allowlist) → bandeau
 * d'avertissement avant l'envoi. `enfants` vide ⇒ rien à envoyer pour cet établissement.
 */
export interface BrouillonEtablissement {
  foyerId: string;
  semaineIso: string;
  etablissementCle: CleEtablissement;
  etablissementLibelle: string;
  destinataire: string;
  sujet: string;
  corps: string; // HTML rendu, figé à l'envoi
  texte: string; // aperçu texte brut
  enfants: EnfantBrouillon[];
  dryRun: boolean;
}

/** Statut d'un envoi de récap au service. */
export type StatutEnvoi = 'EN_COURS' | 'ENVOYE' | 'ECHEC' | 'DRY_RUN';

/** Résultat d'un envoi agrégé par établissement (action sortante réelle, idempotente). */
export interface EnvoiEtablissementResultat {
  foyerId: string;
  semaineIso: string;
  etablissementCle: CleEtablissement;
  destinataire: string;
  statut: StatutEnvoi;
  messageId: string | null;
  erreur: string | null;
  envoyeLe: string | null;
}

// Contrat enrichi conservé côté client (le BFF ne renvoie pas la semaine-type ;
// on la mémorise pour piloter le calendrier). Voir utils/store.ts.
export interface ContratLocal extends ContratVue {
  heuresAnnuellesContractualisees?: number;
  nbMensualites?: number;
  semaineType?: SemaineTypeCreche;
  semaineAbcm?: SemaineAbcm;
}
