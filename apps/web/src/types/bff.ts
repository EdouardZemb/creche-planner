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

/** Une version de ressources d'un foyer — dérivée de `components.schemas.FoyerVersionVue`. */
export type FoyerVersionVue = SchemaComposant<'FoyerVersionVue'>;

/** Vue projetée d'un enfant — dérivée de `components.schemas.EnfantVue`. */
export type EnfantVue = SchemaComposant<'EnfantVue'>;

/** Vue projetée d'un parent — dérivée de `components.schemas.ParentVue`. */
export type ParentVue = SchemaComposant<'ParentVue'>;

/**
 * Document d'export des données personnelles du foyer (portabilité, lot 3) —
 * dérivé de `components.schemas.ExportPortabiliteVue`. Le web ne lit aucune
 * ligne : il télécharge le document tel quel. Les sections sont contractées,
 * les lignes volontairement libres (cf. `docs/37-registre-des-traitements.md` §6).
 */
export type ExportPortabiliteVue = SchemaComposant<'ExportPortabiliteVue'>;

/** Identité courante + droits (admin, foyers autorisés) — dérivée de `components.schemas.MoiVue`. */
export type MoiVue = SchemaComposant<'MoiVue'>;

/**
 * Vue « Mon profil » du parent connecté (A1) — dérivée de
 * `components.schemas.MonProfilVue` : sa ligne parent ciblée sur lui (résolue
 * côté serveur depuis l'identité) + ses préférences de notification effectives.
 */
export type MonProfilVue = SchemaComposant<'MonProfilVue'>;

/**
 * Préférence de notification effective (type × canal) — dérivée de
 * `components.schemas.PreferenceVue` (défaut applicatif fusionné avec le choix
 * explicite stocké).
 */
export type PreferenceVue = SchemaComposant<'PreferenceVue'>;

/** Type de notification préférençable — dérivé de l'enum de `PreferenceVue`. */
export type TypeNotification = PreferenceVue['typeNotification'];

/** Canal de notification — dérivé de l'enum de `PreferenceVue`. */
export type CanalNotification = PreferenceVue['canal'];

/**
 * Corps d'écriture des préférences de notification — dérivé du requestBody de
 * `PUT /api/v1/moi/preferences` (`{ preferences: [{ typeNotification, canal, actif }] }`).
 */
export type MajPreferences = CorpsRequeteJson<'/api/v1/moi/preferences', 'put'>;

/**
 * Une notification de l'**inbox in-app** (PR6, journal informationnel lu/non-lu) —
 * dérivée de `components.schemas.NotificationInApp`. `luLe` null tant que non lue.
 */
export type NotificationInApp = SchemaComposant<'NotificationInApp'>;

/**
 * Panneau de l'inbox in-app (notifications récentes + compteur de non-lus) — dérivé de
 * la réponse 200 de `GET /api/v1/moi/notifications` (`components.schemas.InboxVue`).
 */
export type InboxVue = ReponseJson<'/api/v1/moi/notifications', 'get', 200>;

/** Vue projetée d'un contrat — dérivée de `components.schemas.ContratVue`. */
export type ContratVue = SchemaComposant<'ContratVue'>;

/**
 * Une **version datée** d'un contrat (SFD 30, historique) — dérivée de
 * `components.schemas.ContratVersionVue`. Les paramètres mode-spécifiques
 * (`semaineType`/`semaineAbcm`) voyagent en `passthrough` (index signature ouverte du
 * schéma) : on les re-type ici pour un accès sûr côté écran d'historique.
 */
export type ContratVersionVue = SchemaComposant<'ContratVersionVue'> & {
  semaineType?: SemaineTypeCreche;
  semaineAbcm?: SemaineAbcm;
};

/**
 * Aperçu d'impact d'une version (SFD 30, US-30-05) — dérivé de
 * `components.schemas.ImpactVersionVue`. `moisCouverts` = mois recalculés par une
 * correction ; `moisCommuniques` ⊆ `moisCouverts` = ceux déjà envoyés à un
 * établissement (avertissement « déjà envoyé »).
 */
export type ImpactVersion = SchemaComposant<'ImpactVersionVue'>;

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

/**
 * Établissement en **entité libre par foyer** (P2/P3, propriété svc-planification)
 * — dérivé de `components.schemas.EtablissementFoyerVue`. Identifié par un `id`
 * libre (plus l'ancien enum fermé `cle`).
 */
export type EtablissementFoyerVue = SchemaComposant<'EtablissementFoyerVue'>;

/**
 * Corps de **création** d'un établissement — dérivé du requestBody de
 * `POST /api/v1/foyers/{foyerId}/etablissements` (seul `nom` requis). Sert aussi
 * de `nouvelEtablissement` à la création d'un contrat (création à la volée).
 */
export type CreerEtablissement = CorpsRequeteJson<
  '/api/v1/foyers/{foyerId}/etablissements',
  'post'
>;

/**
 * Corps de **modification** d'un établissement — dérivé du requestBody de
 * `PUT /api/v1/foyers/{foyerId}/etablissements/{id}` (tous les champs optionnels).
 */
export type ModifierEtablissement = CorpsRequeteJson<
  '/api/v1/foyers/{foyerId}/etablissements/{id}',
  'put'
>;

/**
 * Ligne de grille ABCM publiée (une tranche, une période) — dérivée de
 * `components.schemas.GrilleAbcmVue`. Montants en CENTIMES (lecture). L'écran
 * « Tarifs » (SFD 30, US-30-02) regroupe les lignes par période.
 */
export type GrilleAbcmVue = SchemaComposant<'GrilleAbcmVue'>;

/**
 * Corps de **publication d'une grille** (EUROS) — dérivé du requestBody de
 * `POST /api/v1/referentiel/grilles` : une période + une ligne par tranche.
 */
export type PublierGrille = CorpsRequeteJson<
  '/api/v1/referentiel/grilles',
  'post'
>;

/** Une ligne de tranche saisie à l'écran — dérivée de `PublierGrille['tranches'][number]`. */
export type PublierGrilleTranche = PublierGrille['tranches'][number];

// ---- Saisies d'écriture dérivables : corps de création de foyer ------------

/** Corps de création d'un foyer (EUROS) — dérivé du requestBody de `POST /api/v1/foyers`. */
export type CreerDossierFoyer = CorpsRequeteJson<'/api/v1/foyers', 'post'>;

/**
 * Corps d'**édition des scalaires** d'un foyer (EUROS) — dérivé du requestBody de
 * `PUT /api/v1/foyers/{id}` (sans enfants/parents, gérés via leurs propres routes).
 */
export type ModifierFoyer = CorpsRequeteJson<'/api/v1/foyers/{id}', 'put'>;

/** Un enfant à créer — dérivé du sous-schéma `enfants[]` de `CreerDossierFoyer`. */
export type CreerEnfant = CreerDossierFoyer['enfants'][number];

/**
 * Corps d'**édition d'un enfant** (`PUT /api/v1/foyers/{id}/enfants/{enfantId}`) —
 * prénom + date. Le renommage se propage aux contrats existants : ils référencent
 * l'enfant par `enfantId` et leur prénom dénormalisé est rafraîchi par projection
 * NATS (`foyer.EnfantModifie` → svc-planification).
 */
export type ModifierEnfant = CorpsRequeteJson<
  '/api/v1/foyers/{id}/enfants/{enfantId}',
  'put'
>;

/** Un parent à rattacher à la création — dérivé du sous-schéma `parents[]` de `CreerDossierFoyer`. */
export type CreerParent = NonNullable<CreerDossierFoyer['parents']>[number];

/**
 * Corps d'**édition d'un parent** (`PUT /api/v1/foyers/{id}/parents/{parentId}`) —
 * tous les champs optionnels (seuls les fournis changent) ; `prenom`/`nom`
 * acceptent `null` pour effacer l'identité douce, `actif` réactive un parent retiré.
 */
export type ModifierParent = CorpsRequeteJson<
  '/api/v1/foyers/{id}/parents/{parentId}',
  'put'
>;

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
  'LUNDI' | 'MARDI' | 'MERCREDI' | 'JEUDI' | 'VENDREDI' | 'SAMEDI' | 'DIMANCHE';

// Contrats (union discriminée par mode — passthrough intégral du BFF).
export interface PlageHoraire {
  debutHeures: number; // 0-23
  debutMinutes: number; // 0-59
  finHeures: number; // 0-24
  finMinutes: number; // 0-59
}

export type SemaineTypeCreche = Partial<Record<JourSemaine, PlageHoraire[]>>;

/**
 * Inscription ALSH **récurrente** d'un jour de semaine (mercredi typiquement) :
 * formule + repas, miroir de `libs/planification/domain` → `JourAlshHebdo`.
 */
export interface JourAlshHebdo {
  type: 'COMPLETE' | 'DEMI';
  repas?: boolean;
}

export interface InscriptionsJour {
  cantine?: boolean;
  periMatin?: boolean;
  periSoir?: boolean;
  /** Inscription ALSH récurrente ce jour de semaine. */
  alsh?: JourAlshHebdo;
}

export type SemaineAbcm = Partial<Record<JourSemaine, InscriptionsJour>>;

export interface CreerContratCreche {
  mode: 'CRECHE_PSU';
  foyerId: string;
  /** Prénom dénormalisé (affichage) ; la référence est `enfantId`. */
  enfant: string;
  /** Lien de référence vers l'enfant (id svc-foyer). */
  enfantId: string;
  valideDu: string;
  valideAu: string | null;
  heuresAnnuellesContractualisees: number;
  nbMensualites: number;
  semaineType: SemaineTypeCreche;
}

export interface CreerContratAbcm {
  mode: 'CANTINE' | 'PERISCOLAIRE' | 'ALSH';
  foyerId: string;
  /** Prénom dénormalisé (affichage) ; la référence est `enfantId`. */
  enfant: string;
  /** Lien de référence vers l'enfant (id svc-foyer). */
  enfantId: string;
  valideDu: string;
  valideAu: string | null;
  semaineAbcm: SemaineAbcm;
  /**
   * Première année d'inscription de l'enfant à l'association ABCM (frais de
   * 1ʳᵉ inscription, chantier Coûts lot 4a). Optionnel, défaut `false` ;
   * volontairement absent de `CreerContratCreche` (jamais pour CRECHE_PSU).
   */
  premiereInscription?: boolean;
}

/**
 * Lien **établissement** d'un contrat (P2) — **obligatoire** depuis P5
 * (`etablissement_id` NOT NULL) et mutuellement exclusif : fournir EXACTEMENT un de
 * `etablissementId` (rattacher un établissement existant) OU `nouvelEtablissement`
 * (créé à la volée dans la même transaction côté service). Les deux champs restent
 * optionnels au niveau TS (l'un OU l'autre) ; le service rejette « aucun des deux »
 * (400). Le `mode` reste une dimension indépendante.
 */
export interface LienEtablissementSaisie {
  etablissementId?: string;
  nouvelEtablissement?: CreerEtablissement;
}

export type CreerContrat = (CreerContratCreche | CreerContratAbcm) &
  LienEtablissementSaisie;

// ---- Versionnement du contrat (SFD 30) : avenant & correction --------------
//
// Un avenant / une correction ne portent QUE les paramètres versionnés (H6 :
// l'enfant, le mode et l'établissement ne sont PAS versionnables — jamais dans ces
// corps). Le `mode` reste présent comme discriminant (fixé = celui du contrat).

/** Paramètres versionnés d'un contrat crèche (semaine type + heures + mensualités). */
export interface ParametresVersionCreche {
  mode: 'CRECHE_PSU';
  heuresAnnuellesContractualisees: number;
  nbMensualites: number;
  semaineType: SemaineTypeCreche;
}

/** Paramètres versionnés d'un contrat ABCM (semaine d'inscriptions). */
export interface ParametresVersionAbcm {
  mode: 'CANTINE' | 'PERISCOLAIRE' | 'ALSH';
  semaineAbcm: SemaineAbcm;
}

/** Paramètres versionnés d'un contrat (union par mode). */
export type ParametresVersion = ParametresVersionCreche | ParametresVersionAbcm;

/**
 * Corps d'un **avenant** (`POST /contrats/:id/versions`) : paramètres versionnés +
 * date d'effet (`YYYY-MM-DD`) + motif optionnel. Aucune identité (H6).
 */
export type SaisieAvenant = ParametresVersion & {
  dateEffet: string;
  motif?: string;
};

/**
 * Corps d'une **correction** de version (`PUT /contrats/:id/versions/:versionId`) :
 * mêmes paramètres versionnés, **sans** date d'effet (la version garde sa date).
 */
export type SaisieCorrectionVersion = ParametresVersion & {
  motif?: string;
};

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

/**
 * Ajustement d'heures **réelles** d'un jour de garde crèche (Lot 2a/2b) : la plage
 * stockée est la présence RÉELLE (arrivée/départ) du jour, pas un delta — elle
 * reste restituable telle quelle et robuste aux évolutions de la semaine type. Le
 * domaine en dérive l'**extension** (minutes hors plage contractuelle → complément)
 * et la **réduction** (minutes de la plage contractuelle non couvertes → candidate à
 * déduction selon `preavisJours`/`certificatMaladie`, même règle que les absences).
 * Miroir web du `ajustementSchema` de svc-planification (`date` requise ici).
 */
export interface AjustementJour extends PlageHoraire {
  date: string; // YYYY-MM-DD
  preavisJours: number;
  certificatMaladie: boolean;
}

/** Ajustement ponctuel d'un jour ABCM (surcharge la semaine type pour une date). */
export interface ExceptionAbcm {
  date: string; // YYYY-MM-DD
  cantine?: boolean;
  periMatin?: boolean;
  periSoir?: boolean;
  /** ALSH ce jour-là : `false` retire un jour récurrent, `true` en ajoute un. */
  alsh?: boolean;
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
  ajustements?: AjustementJour[]; // CRECHE_PSU — heures réelles d'un jour gardé
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
  ajustements?: AjustementJour[];
  exceptions?: ExceptionAbcm[];
  joursAlsh?: JourAlsh[];
}

/** Réponse de lecture d'une saisie de planning : la saisie stockée ou `null`. */
export interface LirePlanningReponse {
  saisie: EcrirePlanning | null;
}

// ---- Notifications : validation hebdomadaire (Lot 4) -----------------------
//
// DÉRIVÉES du contrat depuis le lot D6 : les 6 routes `/api/v1/notifications/*`
// sont décrites dans l'OpenAPI de la gateway. Elles ne l'étaient pas — la garde
// `openapi.couverture.spec.ts` (api-gateway) l'a montré en confrontant le
// document au graphe de modules Nest — et ces types étaient alors un miroir
// manuel de svc-notifications que rien ne réconciliait.

/** Statut de la validation d'une semaine — dérivé de l'enum du contrat. */
export type StatutNotification =
  SchemaComposant<'NotificationAValiderVue'>['statut'];

/**
 * Une semaine à valider (indicateur in-app) — dérivée de
 * `components.schemas.NotificationAValiderVue`. Enrichie par le BFF (jointure avec les
 * contrats du foyer) du prénom de l'enfant et du mode de garde, pour distinguer N lignes
 * d'une même semaine dans l'encart. `enfant`/`mode` sont absents si le contrat n'est plus
 * listé côté BFF (l'écran retombe alors sur le libellé de repli « Planning de la … »).
 */
export type NotificationAValider = SchemaComposant<'NotificationAValiderVue'>;

/**
 * Un jour modifié entre le snapshot de notification et la relecture — dérivé du
 * sous-schéma `jours[]` de `DeltaModifs`. `avant`/`apres` restent `unknown` : le
 * contrat les laisse ouverts (forme propriété de svc-notifications).
 */
export type DeltaJour = SchemaComposant<'DeltaModifs'>['jours'][number];

/** Jours modifiés à la validation — dérivés de `components.schemas.DeltaModifs`. */
export type DeltaModifs = SchemaComposant<'DeltaModifs'>;

/** Résultat d'une validation de semaine — dérivé de `components.schemas.ValidationResultat`. */
export type ValidationResultat = SchemaComposant<'ValidationResultat'>;

// ---- Notifications : vue hebdomadaire consolidée éditable ------------------
//
// Dérivée du contrat (D6), SAUF les besoins datés et les semaines-types : la
// gateway les relaie tels quels depuis svc-planification et n'en valide que
// l'enveloppe, donc le contrat les décrit ouverts (`additionalProperties: true`).
// Le front garde ses formes précises pour ces champs-là et les greffe sur le
// type dérivé — même patron que `ContratVersionVue` plus haut.

/** Entrées datées d'un jour (mêmes catégories que la saisie mensuelle). */
export interface SaisieJourBesoins {
  joursSupplementaires: JourSupplementaire[];
  absences: AbsenceCreche[];
  ajustements: AjustementJour[];
  exceptions: ExceptionAbcm[];
  joursAlsh: JourAlsh[];
}

/** Besoins d'une semaine : jour `YYYY-MM-DD` → entrées (jours vides omis). */
export type BesoinsSemaine = Record<string, SaisieJourBesoins>;

/**
 * Établissement réel concerné par la semaine (entité libre, `svc-planification`)
 * — dérivé de `components.schemas.EtablissementConcerneVue`. `preavisRegle` est
 * `null` si l'établissement ne l'a pas (encore) renseignée.
 */
export type EtablissementConcerne = SchemaComposant<'EtablissementConcerneVue'>;

/**
 * Un contrat actif de la semaine, avec ses besoins datés et son établissement —
 * dérivé de `components.schemas.ContratBesoinsVue`, dont les trois champs
 * ouverts sont re-typés ici pour un accès sûr côté écran.
 *
 * `semaineType`/`semaineAbcm` sont le planning de BASE du contrat, fourni selon
 * le mode : ils permettent d'afficher les horaires planifiés d'un jour normal
 * sans ouvrir la saisie. Les entrées datées de `besoins` restent les exceptions
 * qui priment sur cette base.
 */
export type ContratBesoinsSemaine = Omit<
  SchemaComposant<'ContratBesoinsVue'>,
  'besoins' | 'semaineType' | 'semaineAbcm'
> & {
  besoins: BesoinsSemaine;
  semaineType?: SemaineTypeCreche;
  semaineAbcm?: SemaineAbcm;
};

/**
 * Vue consolidée d'une semaine éditable du foyer : les 7 jours, les établissements
 * concernés et les contrats actifs avec leurs besoins, groupables à l'écran par
 * enfant → établissement/mode. Ouverte depuis une notification A_VALIDER. Dérivée
 * de `components.schemas.SemaineBesoinsVue` (contrats re-typés, cf. ci-dessus).
 */
export type SemaineBesoins = Omit<
  SchemaComposant<'SemaineBesoinsVue'>,
  'contrats'
> & {
  contrats: ContratBesoinsSemaine[];
};

// ---- Notifications : mail au service AGRÉGÉ par établissement (Phase 4) -----
//
// Granularité de l'édition hebdo : un seul mail par établissement regroupant tous
// les enfants du foyer dont la semaine a été validée avec modifications (remplace
// l'envoi par-contrat du Lot 6).

/**
 * Un enfant du foyer concerné par le récap d'un établissement (diff figé du Lot 4)
 * — dérivé de `components.schemas.EnfantBrouillonVue`.
 */
export type EnfantBrouillon = SchemaComposant<'EnfantBrouillonVue'>;

/**
 * Brouillon régénérable du mail **agrégé par établissement** adressé au service
 * (crèche / école ABCM) après relecture humaine — dérivé de
 * `components.schemas.BrouillonEtablissementVue`. `dryRun` indique qu'un envoi réel
 * serait neutralisé (bac à sable ou destinataire hors allowlist) → bandeau
 * d'avertissement avant l'envoi. `enfants` vide ⇒ rien à envoyer pour cet
 * établissement. `routable: false` ⇒ **aucun envoi possible** (crèche sans e-mail
 * ou archivée) : le front affiche un avertissement au lieu du bouton d'envoi, et
 * `destinataire` vaut `''`. `'ARCHIVE'` a la **priorité** sur `'SANS_EMAIL'`.
 */
export type BrouillonEtablissement =
  SchemaComposant<'BrouillonEtablissementVue'>;

/**
 * Objet + corps **édités par le parent** transmis à l'envoi d'un récap
 * établissement (L8/L9) : texte brut, échappé et journalisé tel quel côté service.
 * Dérivé des champs optionnels du requestBody de
 * `POST /api/v1/notifications/envois/etablissement` — ils y sont optionnels car
 * l'invariant « les deux ensemble ou aucun » n'est pas exprimable en JSON Schema
 * côté gateway (il est vérifié par le DTO Zod, 400 sinon) ; ici on les rend requis
 * puisque ce type EST le cas « les deux fournis ».
 */
export type CorpsEnvoiEtablissement = Required<
  Pick<
    CorpsRequeteJson<'/api/v1/notifications/envois/etablissement', 'post'>,
    'sujet' | 'corps'
  >
>;

/** Statut d'un envoi de récap au service — dérivé de l'enum du contrat. */
export type StatutEnvoi =
  SchemaComposant<'EnvoiEtablissementResultat'>['statut'];

/**
 * Résultat d'un envoi agrégé par établissement (action sortante réelle,
 * idempotente) — dérivé de `components.schemas.EnvoiEtablissementResultat`.
 */
export type EnvoiEtablissementResultat =
  SchemaComposant<'EnvoiEtablissementResultat'>;

// ---- Notifications : suivi des envois (B1, lecture seule) -------------------
//
// Dérivées du contrat depuis D6 (la route `GET …/semaine/{foyerId}/{semaineIso}/
// envois` y est décrite) : le miroir manuel du schéma Zod du client gateway a
// disparu au profit de la chaîne document → openapi-typescript.

/** Statut de livraison du rappel du mardi vers UN parent. */
export type StatutRappelParent = SchemaComposant<'SuiviRappelParent'>['statut'];

/** Statut de l'envoi du rappel hebdo du mardi (agrégat foyer). */
export type StatutRappelHebdo = SchemaComposant<'SuiviRappelHebdo'>['statut'];

/** Livraison du récap du mardi vers un parent (ledger `envoi_recap_parent`). */
export type SuiviRappelParent = SchemaComposant<'SuiviRappelParent'>;

/** État d'envoi du rappel hebdo du mardi aux parents (+ détail par parent). */
export type SuiviRappelHebdo = SchemaComposant<'SuiviRappelHebdo'>;

/** État d'envoi du récap agrégé vers un établissement (`envoi_etablissement`). */
export type SuiviEnvoiEtablissement =
  SchemaComposant<'SuiviEnvoiEtablissement'>;

/**
 * Suivi **persistant** des envois d'une `(foyer, semaine)` (B1) : statut du rappel aux
 * parents (`null` si la semaine n'a jamais été programmée) et des récaps aux
 * établissements. Affiché dans le bloc « Suivi des envois » de l'encart de validation.
 */
export type SuiviEnvois = SchemaComposant<'SuiviEnvoisVue'>;

// Contrat enrichi conservé côté client (le BFF ne renvoie pas la semaine-type ;
// on la mémorise pour piloter le calendrier). Voir utils/store.ts.
export interface ContratLocal extends ContratVue {
  heuresAnnuellesContractualisees?: number;
  nbMensualites?: number;
  semaineType?: SemaineTypeCreche;
  semaineAbcm?: SemaineAbcm;
}

// ---- Unités associatives (SFD 40) -------------------------------------------

/**
 * Suivi de l'engagement de bénévolat du foyer : engagement courant, sessions et
 * les trois compteurs. `engagement: null` = aucune période déclarée — l'écran
 * propose alors la déclaration, il n'affiche pas trois zéros qui laisseraient
 * croire le foyer à jour.
 */
export type SuiviUaVue = ReponseJson<'/api/v1/unites-associatives', 'get', 200>;

/** L'engagement d'une période (quota, valeur d'UA, dates, caution). */
export type EngagementUaVue = SchemaComposant<'EngagementUaVue'>;

/** Une session de bénévolat — la recopie d'un créneau pris sur le site travaux. */
export type SessionUaVue = SchemaComposant<'SessionUaVue'>;

/** Les trois compteurs, l'échéance et les deux coûts projetés (SFD 40 §3.1). */
export type CompteursUaVue = SchemaComposant<'CompteursUaVue'>;

/** Un coût projeté AVEC son hypothèse — les deux ne se séparent pas (RM-40-05). */
export type CoutProjeteUaVue = SchemaComposant<'CoutProjeteUaVue'>;

/** Corps de déclaration d'un engagement. */
export type DeclarerEngagementUa = CorpsRequeteJson<
  '/api/v1/unites-associatives',
  'post'
>;

/** Corps d'ajout d'une session (quatre champs utiles, le reste facultatif). */
export type AjouterSessionUa = CorpsRequeteJson<
  '/api/v1/unites-associatives/sessions',
  'post'
>;

/** Corps de modification d'une session (« c'est fait », « ça n'a pas eu lieu »). */
export type ModifierSessionUa = CorpsRequeteJson<
  '/api/v1/unites-associatives/sessions/{sessionId}',
  'put'
>;

// ── Calendrier d'ouverture (SFD 31) ─────────────────────────────────────────

/** Les périodes connues (couche 2), telles que l'écran de saisie les liste. */
export type PeriodesCalendrierVue = SchemaComposant<'PeriodesCalendrier'>;

/** Une période : bornes INCLUSES, et sa provenance (`IMPORT` ou `MANUEL`). */
export type PeriodeCalendrierVue = SchemaComposant<'PeriodeCalendrier'>;

/** Les exceptions ponctuelles connues (couche 1, la plus forte). */
export type ExceptionsCalendrierVue = SchemaComposant<'ExceptionsCalendrier'>;

/** Une exception ponctuelle : un jour, un type, un libellé. */
export type ExceptionCalendrierVue = SchemaComposant<'ExceptionCalendrier'>;

/**
 * Compte rendu d'import (US-31-01). Volontairement PAS la liste des périodes :
 * l'écran relit `…/calendrier/periodes` ensuite. Deux vues de la même chose
 * finiraient par diverger le jour où une retouche s'intercale.
 */
export type ImportCalendrierVue = ReponseJson<
  '/api/v1/foyers/{foyerId}/etablissements/{id}/calendrier/import',
  'post',
  200
>;

/** Corps de saisie d'une période à la main. */
export type SaisirPeriodeCalendrier = CorpsRequeteJson<
  '/api/v1/foyers/{foyerId}/etablissements/{id}/calendrier/periodes',
  'post'
>;

/** Corps de pose d'une exception ponctuelle. */
export type PoserExceptionCalendrier = CorpsRequeteJson<
  '/api/v1/foyers/{foyerId}/etablissements/{id}/calendrier/exceptions',
  'post'
>;

/** Semaine type d'ouverture, par régime (couche 3). */
export type RecurrencesCalendrierVue =
  SchemaComposant<'RecurrencesCalendrier'>;

/** Corps de remplacement de la semaine type d'un régime. */
export type RemplacerRecurrencesCalendrier = CorpsRequeteJson<
  '/api/v1/foyers/{foyerId}/etablissements/{id}/calendrier/recurrences',
  'put'
>;
