import { randomUUID } from 'node:crypto';
import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { and, eq } from 'drizzle-orm';
import {
  ContratCreche,
  genererPrestationMoisSegments,
  semaineTypeDepuisJson,
  type ContratPourGeneration,
  type PlanningMensuel,
  type SemaineTypeAbcm,
  type SemaineTypeJson,
} from '@creche-planner/planification-domain';
import {
  depuisSuite,
  selectionnerVersionApplicable,
} from '@creche-planner/shared-kernel';
import {
  CONTRAT_CREE_V2_TYPE,
  CONTRAT_MODIFIE_TYPE,
  CONTRAT_MODIFIE_V2_TYPE,
  CONTRAT_SUPPRIME_TYPE,
  ETABLISSEMENT_CREE_TYPE,
  PLANNING_MODIFIE_TYPE,
  type ContratCreeV2Payload,
  type ContratModifiePayload,
  type ContratModifieV2Payload,
  type ContratSupprimePayload,
  type EtablissementCreePayload,
  type ModeContrat,
  type PlanningModifiePayload,
} from '@creche-planner/contracts-planification';
import { DRIZZLE, traceIdCourant } from '@creche-planner/nest-commons';
import type { Database } from '../database/database.types.js';
import {
  contrat,
  contratVersion,
  correctionJournal,
  etablissement,
  outbox,
  planningMois,
  type ContratRow,
  type ContratVersionRow,
} from '../database/schema.js';
import {
  joursDeLaSemaine,
  moisDeLaSemaine,
} from '@creche-planner/shared-semaine';
import { ReferentielClient } from './referentiel.client.js';
import {
  fusionnerSemaineDansMois,
  type BesoinsSemaine,
} from './fusion-semaine.js';
import type {
  CorrigerVersionDto,
  CreerAvenantDto,
  CreerContratDto,
  EcrirePlanningDto,
  ModifierContratDto,
} from './planification.dto.js';

/** Projection lisible d'un contrat. */
export interface ContratVue {
  readonly id: string;
  readonly foyerId: string;
  readonly enfant: string;
  /**
   * Identifiant de l'enfant (agrégat `svc-foyer`) — lien de référence du contrat ;
   * `null` pour un contrat historique pas encore rapproché (back-fill en attente).
   */
  readonly enfantId: string | null;
  readonly mode: string;
  readonly valideDu: string;
  readonly valideAu: string | null;
  /**
   * Première année d'inscription de l'enfant à l'association ABCM (frais de
   * 1ʳᵉ inscription, doc 02 §4.4 — lot 4a). Toujours `false` pour CRECHE_PSU.
   */
  readonly premiereInscription: boolean;
}

/**
 * Projection détaillée d'un contrat : ajoute la configuration spécifique au mode
 * (semaine type / inscriptions, heures, mensualités) pour piloter l'app (liste
 * des contrats + calendriers de planning), que le `ContratVue` minimal n'expose pas.
 */
export interface ContratDetailVue extends ContratVue {
  /**
   * Établissement réel rattaché au contrat (lien explicite P2), ou `null` si aucun.
   * Exposé pour que le BFF route le récap hebdo par ce lien (P3) plutôt que par le
   * mode ; le `ContratVue` minimal (résolution contrat→foyer) ne le porte pas.
   */
  readonly etablissementId: string | null;
  readonly heuresAnnuellesContractualisees: number | null;
  readonly nbMensualites: number | null;
  readonly semaineType: unknown;
  readonly semaineAbcm: unknown;
}

/** Quantités d'une prestation, sérialisées (les Durée → minutes). */
export interface PrestationVue {
  readonly mode: string;
  readonly [cle: string]: unknown;
}

/**
 * Vue d'une **version** d'un contrat (historique, US-30-04/06) : ses paramètres
 * versionnés + sa période dérivée (`du`/`au`, `au = null` si ouverte) + sa
 * traçabilité (`saisiLe`, `motif`).
 */
export interface ContratVersionVue {
  readonly id: string;
  readonly contratId: string;
  readonly mode: string;
  readonly dateEffet: string;
  readonly du: string;
  readonly au: string | null;
  readonly heuresAnnuellesContractualisees: number | null;
  readonly nbMensualites: number | null;
  readonly semaineType: unknown;
  readonly semaineAbcm: unknown;
  readonly saisiLe: string;
  readonly motif: string | null;
}

/** Paramètres **versionnés** d'un contrat (colonnes de `contrat_version`). */
interface ChampsVersion {
  readonly heuresAnnuellesContractualisees: number | null;
  readonly nbMensualites: number | null;
  readonly semaineType: unknown;
  readonly semaineAbcm: unknown;
}

/** Transaction Drizzle (le `tx` passé au callback de `db.transaction`). */
type Tx = Parameters<Parameters<Database['transaction']>[0]>[0];

/** Lecteur (base ou transaction) — factorise lectures hors et dans transaction. */
type Lecteur = Database | Tx;

/** Date du jour au format ISO `YYYY-MM-DD` (comparaison lexicographique du socle). */
function aujourdhuiIso(): string {
  return new Date().toISOString().slice(0, 10);
}

/** Dernier jour du mois `YYYY-MM` au format ISO `YYYY-MM-DD`. */
function derniereDateDuMois(mois: string): string {
  const [a = 0, m = 0] = mois.split('-').map(Number);
  // `Date.UTC(a, m, 0)` : jour 0 du mois suivant = dernier jour du mois `m` (1-based).
  const jour = new Date(Date.UTC(a, m, 0)).getUTCDate();
  return `${mois}-${String(jour).padStart(2, '0')}`;
}

/**
 * Liste des mois `YYYY-MM` couverts par la période `[du, au]` (bornes ISO
 * `YYYY-MM-DD` incluses). `au = null` (période ouverte) est plafonné au mois de
 * `du` (une version ouverte « couvre » au moins son mois de départ — l'aperçu
 * d'impact ne projette pas indéfiniment dans le futur).
 */
function moisEntre(du: string, au: string | null): string[] {
  if (du === '') {
    return [];
  }
  const borneHaute = au ?? du;
  const mois: string[] = [];
  let courant = du.slice(0, 7);
  const fin = borneHaute.slice(0, 7);
  while (courant <= fin) {
    mois.push(courant);
    const [a = 0, m = 0] = courant.split('-').map(Number);
    const suivant = m === 12 ? { a: a + 1, m: 1 } : { a, m: m + 1 };
    courant = `${String(suivant.a).padStart(4, '0')}-${String(suivant.m).padStart(2, '0')}`;
  }
  return mois;
}

@Injectable()
export class PlanificationService {
  constructor(
    @Inject(DRIZZLE) private readonly db: Database,
    private readonly referentiel: ReferentielClient,
  ) {}

  /**
   * Crée un contrat + émet `ContratCree` dans la même transaction (outbox).
   * **Idempotent** (chantier « Confiance », lot 3 — C1) : la gateway génère l'`id`
   * AVANT son retry résilient, si bien que le rejeu du même POST (réponse lente)
   * retombe sur la PK `contrat.id` (`onConflictDoNothing`) → aucun doublon, aucun
   * second `ContratCree`, et la ressource déjà créée est renvoyée à l'identique.
   */
  async creerContrat(dto: CreerContratDto): Promise<ContratVue> {
    // Valide la cohérence métier via le domaine avant de persister.
    if (dto.mode === 'CRECHE_PSU') {
      ContratCreche.creer({
        valideDu: dto.valideDu,
        // `null` = contrat sans terme (`AM-13`) : le domaine sait désormais le
        // représenter, on ne lui invente plus une fin au jour du début.
        ...(dto.valideAu !== null ? { valideAu: dto.valideAu } : {}),
        heuresAnnuellesContractualisees: dto.heuresAnnuellesContractualisees,
        nbMensualites: dto.nbMensualites,
        semaineType: semaineTypeDepuisJson(dto.semaineType),
      });
    }

    // Clé d'idempotence fournie par la gateway (partagée par les 2 tentatives d'un
    // retry) ; à défaut (client legacy), on la génère comme avant.
    const id = dto.id ?? randomUUID();
    // Première inscription ABCM (lot 4a) : le DTO crèche n'expose pas le champ →
    // toujours `false` pour CRECHE_PSU ; défaut `false` si non coché (ABCM).
    const premiereInscription =
      dto.mode === 'CRECHE_PSU' ? false : (dto.premiereInscription ?? false);
    return this.db.transaction(async (tx) => {
      // Résout le lien établissement DANS la même transaction (atomicité : pas de
      // contrat orphelin ni d'établissement fantôme — cf. `resoudreEtablissement`).
      const etablissementId = await this.resoudreEtablissement(
        tx,
        dto.foyerId,
        dto,
      );
      // Insert idempotent : un rejeu (même `id`) ne réinsère rien et ne renvoie
      // aucune ligne (`returning` vide).
      const insere = await tx
        .insert(contrat)
        .values({
          id,
          foyerId: dto.foyerId,
          enfant: dto.enfant,
          enfantId: dto.enfantId,
          mode: dto.mode,
          etablissementId,
          valideDu: dto.valideDu,
          valideAu: dto.valideAu,
          premiereInscription,
          heuresAnnuellesContractualisees:
            dto.mode === 'CRECHE_PSU'
              ? dto.heuresAnnuellesContractualisees
              : null,
          nbMensualites: dto.mode === 'CRECHE_PSU' ? dto.nbMensualites : null,
          semaineType: dto.mode === 'CRECHE_PSU' ? dto.semaineType : null,
          semaineAbcm: dto.mode === 'CRECHE_PSU' ? null : dto.semaineAbcm,
        })
        .onConflictDoNothing({ target: contrat.id })
        .returning({ id: contrat.id });

      if (insere.length === 0) {
        // Rejeu du même POST : le contrat existe déjà (créé par la 1ʳᵉ tentative).
        // On NE ré-émet PAS `ContratCree` (pas de double projection) et on relit la
        // ressource pour la renvoyer à l'identique (201 conservé côté contrôleur).
        const existants = await tx
          .select()
          .from(contrat)
          .where(eq(contrat.id, id));
        const ligne = existants[0];
        if (!ligne) {
          throw new Error(
            `contrat introuvable après conflit d'idempotence : ${id}`,
          );
        }
        return this.versContratVue(ligne);
      }

      // Version initiale (SFD 30 lot 4) : `date_effet = valide_du`, portant les
      // paramètres versionnés du contrat. Les colonnes de `contrat` en restent la
      // projection (aucun lecteur à migrer). Même transaction que le contrat.
      const versionId = randomUUID();
      await tx.insert(contratVersion).values({
        id: versionId,
        contratId: id,
        dateEffet: dto.valideDu,
        heuresAnnuellesContractualisees:
          dto.mode === 'CRECHE_PSU'
            ? dto.heuresAnnuellesContractualisees
            : null,
        nbMensualites: dto.mode === 'CRECHE_PSU' ? dto.nbMensualites : null,
        semaineType: dto.mode === 'CRECHE_PSU' ? dto.semaineType : null,
        semaineAbcm: dto.mode === 'CRECHE_PSU' ? null : dto.semaineAbcm,
      });

      // v2 additive (RM-30-06) : payload v1 + versionId + dateEffet de la version
      // initiale — les projections dispatchent v1 ET v2 (champs projetés inchangés).
      const payload: ContratCreeV2Payload = {
        contratId: id,
        foyerId: dto.foyerId,
        enfant: dto.enfant,
        enfantId: dto.enfantId,
        mode: dto.mode,
        valideDu: dto.valideDu,
        valideAu: dto.valideAu,
        etablissementId,
        premiereInscription,
        versionId,
        dateEffet: dto.valideDu,
      };
      await tx.insert(outbox).values({
        id: randomUUID(),
        type: CONTRAT_CREE_V2_TYPE,
        payload,
        traceId: traceIdCourant(),
      });

      return {
        id,
        foyerId: dto.foyerId,
        enfant: dto.enfant,
        enfantId: dto.enfantId,
        mode: dto.mode,
        valideDu: dto.valideDu,
        valideAu: dto.valideAu,
        premiereInscription,
      };
    });
  }

  /** Projette une ligne `contrat` en `ContratVue` (cœur du contrat). */
  private versContratVue(ligne: ContratRow): ContratVue {
    return {
      id: ligne.id,
      foyerId: ligne.foyerId,
      enfant: ligne.enfant,
      enfantId: ligne.enfantId,
      mode: ligne.mode,
      valideDu: ligne.valideDu,
      valideAu: ligne.valideAu,
      premiereInscription: ligne.premiereInscription,
    };
  }

  /**
   * Liste les contrats d'un foyer, avec leur configuration mode-spécifique
   * (semaine type / inscriptions, heures, mensualités). Lecture seule : alimente
   * la gestion des contrats et les calendriers de planning du front (qui ne
   * stocke plus rien côté client). Triée par enfant puis mode (rendu stable).
   */
  async listerContrats(foyerId: string): Promise<ContratDetailVue[]> {
    const lignes = await this.db
      .select()
      .from(contrat)
      .where(eq(contrat.foyerId, foyerId))
      .orderBy(contrat.enfant, contrat.mode);
    return lignes.map((l) => ({
      id: l.id,
      foyerId: l.foyerId,
      enfant: l.enfant,
      enfantId: l.enfantId,
      mode: l.mode,
      etablissementId: l.etablissementId,
      valideDu: l.valideDu,
      valideAu: l.valideAu,
      premiereInscription: l.premiereInscription,
      heuresAnnuellesContractualisees: l.heuresAnnuellesContractualisees,
      nbMensualites: l.nbMensualites,
      semaineType: l.semaineType,
      semaineAbcm: l.semaineAbcm,
    }));
  }

  /**
   * Lit le **cœur** d'un contrat (sans la configuration mode-spécifique) à partir
   * de son id. Sert la **résolution contrat → foyer** de l'autorisation par foyer
   * côté gateway (le guard d'appartenance n'a en main qu'un `contratId` sur les
   * routes `/contrats/:id/...`). 404 si le contrat n'existe pas.
   */
  async lireContrat(id: string): Promise<ContratVue> {
    const lignes = await this.db
      .select()
      .from(contrat)
      .where(eq(contrat.id, id));
    const ligne = lignes[0];
    if (!ligne) {
      throw new NotFoundException(`contrat introuvable : ${id}`);
    }
    return {
      id: ligne.id,
      foyerId: ligne.foyerId,
      enfant: ligne.enfant,
      enfantId: ligne.enfantId,
      mode: ligne.mode,
      valideDu: ligne.valideDu,
      valideAu: ligne.valideAu,
      premiereInscription: ligne.premiereInscription,
    };
  }

  /**
   * Crée un **avenant** : une nouvelle version datée du contrat (SFD 30 lot 4,
   * US-30-01). Insère la version à `dateEffet` — qui clôt implicitement la
   * précédente la veille (fin dérivée) — **sans toucher** aux `planning_mois`
   * saisis (fini le cascade-delete destructif), rafraîchit la projection de la
   * version courante sur `contrat`, et émet `ContratModifie`. 404 si le contrat
   * n'existe pas ; 400 si `dateEffet` précède le début du contrat ou si le mode
   * diffère (l'identité n'est pas versionnée, H6) ; 409 si une version existe déjà
   * à cette date.
   */
  async creerAvenant(
    contratId: string,
    dto: CreerAvenantDto,
  ): Promise<ContratVue> {
    return this.db.transaction(async (tx) => {
      const contratActuel = await this.exigerContrat(tx, contratId);
      this.exigerModeIdentique(dto.mode, contratActuel.mode);
      if (dto.dateEffet < contratActuel.valideDu) {
        throw new BadRequestException(
          `date d'effet (${dto.dateEffet}) antérieure au début du contrat (${contratActuel.valideDu})`,
        );
      }
      const champs = this.champsVersionDepuisDto(dto);
      this.validerVersionDomaine(contratActuel, dto.dateEffet, champs);
      const versionId = randomUUID();
      const insere = await tx
        .insert(contratVersion)
        .values({
          id: versionId,
          contratId,
          dateEffet: dto.dateEffet,
          ...champs,
          motif: dto.motif ?? null,
        })
        .onConflictDoNothing({
          target: [contratVersion.contratId, contratVersion.dateEffet],
        })
        .returning({ id: contratVersion.id });
      if (insere.length === 0) {
        throw new ConflictException(
          `une version existe déjà à la date d'effet ${dto.dateEffet}`,
        );
      }
      await this.rafraichirProjectionContrat(tx, contratId);
      await this.emettreContratModifie(tx, contratActuel, {
        id: versionId,
        dateEffet: dto.dateEffet,
      });
      return this.versContratVue(await this.exigerContrat(tx, contratId));
    });
  }

  /**
   * **Corrige** une version existante (US-30-05) : écrase ses paramètres versionnés
   * **sans déplacer sa date d'effet**, journalise l'avant/après (`correction_journal`),
   * rafraîchit la projection si la version corrigée est courante, et émet
   * `ContratModifie`. Geste rétroactif tracé, distinct de l'avenant. 404 si le
   * contrat ou la version n'existe pas ; 400 si le mode diffère (H6).
   */
  async corrigerVersion(
    contratId: string,
    versionId: string,
    dto: CorrigerVersionDto,
  ): Promise<ContratVue> {
    return this.db.transaction(async (tx) => {
      const contratActuel = await this.exigerContrat(tx, contratId);
      this.exigerModeIdentique(dto.mode, contratActuel.mode);
      const version = await this.exigerVersion(tx, contratId, versionId);
      const champs = this.champsVersionDepuisDto(dto);
      this.validerVersionDomaine(contratActuel, version.dateEffet, champs);
      await this.appliquerCorrection(
        tx,
        contratActuel,
        version,
        champs,
        dto.motif ?? null,
      );
      return this.versContratVue(await this.exigerContrat(tx, contratId));
    });
  }

  /**
   * Corrige la **version courante** d'un contrat depuis le corps complet d'un
   * contrat (façade de compatibilité `PUT /contrats/:id/version-courante`,
   * remplaçant l'ancien `PUT /contrats/:id`). Seuls les champs versionnés sont
   * appliqués : l'identité n'est pas versionnée (H6) et les `planning_mois` saisis
   * **survivent** (plus de cascade-delete). 404 si le contrat n'existe pas ; 400 si
   * le mode du corps diffère de celui du contrat.
   */
  async corrigerVersionCourante(
    contratId: string,
    dto: ModifierContratDto,
  ): Promise<ContratVue> {
    return this.db.transaction(async (tx) => {
      const contratActuel = await this.exigerContrat(tx, contratId);
      this.exigerModeIdentique(dto.mode, contratActuel.mode);
      // Compatibilité web (formulaire d'édition pré-lot 5) : le corps complet
      // porte aussi des champs NON versionnés — on les reconduit comme l'ancien
      // `PUT /contrats/:id` (bornes de vie, enfant, établissement résolu avec la
      // tolérance « archivé inchangé », 1ʳᵉ inscription), SANS toucher ni au
      // `foyerId` (identité) ni aux plannings saisis (fini la cascade).
      const etablissementId = await this.resoudreEtablissement(
        tx,
        contratActuel.foyerId,
        dto,
        contratActuel.etablissementId,
      );
      await tx
        .update(contrat)
        .set({
          enfant: dto.enfant,
          enfantId: dto.enfantId,
          etablissementId,
          valideDu: dto.valideDu,
          valideAu: dto.valideAu,
          premiereInscription:
            dto.mode === 'CRECHE_PSU'
              ? false
              : (dto.premiereInscription ?? false),
          updatedAt: new Date(),
        })
        .where(eq(contrat.id, contratId));
      const contratMaj = await this.exigerContrat(tx, contratId);
      const versions = await this.versionsDeContrat(tx, contratId);
      const courante = this.resoudreVersionCourante(versions);
      const champs = this.champsVersionDepuisDto(dto);
      this.validerVersionDomaine(contratMaj, courante.dateEffet, champs);
      await this.appliquerCorrection(tx, contratMaj, courante, champs, null);
      return this.versContratVue(await this.exigerContrat(tx, contratId));
    });
  }

  /**
   * Historique des versions d'un contrat (US-30-04/06), de la plus récente à la
   * plus ancienne. Chaque entrée porte sa **période dérivée** (`du`/`au`, `au` =
   * veille de la version suivante ou `null` si ouverte) reconstruite par le socle
   * de versionnement. 404 si le contrat n'existe pas.
   */
  async listerVersions(contratId: string): Promise<ContratVersionVue[]> {
    const contratActuel = await this.exigerContrat(this.db, contratId);
    const versions = await this.versionsDeContrat(this.db, contratId);
    const periodes = depuisSuite(
      versions.map((v) => ({ dateEffet: v.dateEffet, valeur: v })),
    );
    const vues = periodes.map((p) => ({
      id: p.valeur.id,
      contratId,
      mode: contratActuel.mode,
      dateEffet: p.valeur.dateEffet,
      du: p.periode.du,
      au: p.periode.au ?? null,
      heuresAnnuellesContractualisees: p.valeur.heuresAnnuellesContractualisees,
      nbMensualites: p.valeur.nbMensualites,
      semaineType: p.valeur.semaineType,
      semaineAbcm: p.valeur.semaineAbcm,
      saisiLe: p.valeur.saisiLe.toISOString(),
      motif: p.valeur.motif,
    }));
    // Plus récente d'abord (historique lisible).
    return vues.sort((a, b) => (a.dateEffet < b.dateEffet ? 1 : -1));
  }

  /**
   * Aperçu d'impact d'une version (US-30-05) : liste des **mois** `YYYY-MM`
   * couverts par sa période (intersectée avec la vie du contrat), du plus ancien au
   * plus récent. Lecture seule, requise avant une correction rétroactive. 404 si le
   * contrat ou la version n'existe pas.
   */
  async apercuImpactVersion(
    contratId: string,
    versionId: string,
  ): Promise<{ versionId: string; moisCouverts: string[] }> {
    const contratActuel = await this.exigerContrat(this.db, contratId);
    await this.exigerVersion(this.db, contratId, versionId);
    const versions = await this.versionsDeContrat(this.db, contratId);
    const periodes = depuisSuite(
      versions.map((v) => ({ dateEffet: v.dateEffet, valeur: v })),
    );
    const cible = periodes.find((p) => p.valeur.id === versionId);
    // `cible` existe (exigerVersion a réussi) ; garde défensive de typage.
    const du = cible?.periode.du ?? '';
    // Borne haute = fin de la version, plafonnée à la fin de vie du contrat.
    const finContrat = contratActuel.valideAu;
    const auVersion = cible?.periode.au ?? null;
    const au =
      finContrat !== null && (auVersion === null || finContrat < auVersion)
        ? finContrat
        : auVersion;
    return { versionId, moisCouverts: moisEntre(du, au) };
  }

  /**
   * Rattache le contrat `contratId` à l'établissement `etablissementId` (lien P2)
   * **sans remplacer le reste du contrat ni invalider ses plannings** — sans
   * remplacement complet du contrat (geste chirurgical dédié au back-fill).
   * Dédié au **back-fill P5** (migration du lien contrat→établissement sur des
   * contrats de production réels) : ne touche QUE `etablissement_id`.
   *
   * Émet `ContratModifie` (état complet relu depuis la ligne) pour que les
   * read-models aval (`svc-notifications` : routage du récap hebdo par
   * `contrat.etablissementId`) projettent le lien. **Idempotent** : si le contrat
   * pointe déjà sur cet établissement, no-op (aucune écriture, aucun événement) —
   * un re-run est sûr. 404 si le contrat est introuvable ; 400 si l'établissement
   * est inconnu ou hors du foyer du contrat (isolation inter-foyers).
   */
  async rattacherEtablissement(
    contratId: string,
    etablissementId: string,
  ): Promise<ContratVue> {
    return this.db.transaction(async (tx) => {
      const lignes = await tx
        .select()
        .from(contrat)
        .where(eq(contrat.id, contratId));
      const ligne = lignes[0];
      if (!ligne) {
        throw new NotFoundException(`contrat introuvable : ${contratId}`);
      }
      const vue: ContratVue = {
        id: ligne.id,
        foyerId: ligne.foyerId,
        enfant: ligne.enfant,
        enfantId: ligne.enfantId,
        mode: ligne.mode,
        valideDu: ligne.valideDu,
        valideAu: ligne.valideAu,
        premiereInscription: ligne.premiereInscription,
      };
      // Idempotence : déjà rattaché à CET établissement → rien à faire.
      if (ligne.etablissementId === etablissementId) {
        return vue;
      }
      // Vérifie l'existence ET l'appartenance au foyer du contrat (400 sinon).
      const etabs = await tx
        .select()
        .from(etablissement)
        .where(
          and(
            eq(etablissement.id, etablissementId),
            eq(etablissement.foyerId, ligne.foyerId),
          ),
        );
      const etab = etabs[0];
      if (!etab) {
        throw new BadRequestException(
          `établissement ${etablissementId} inconnu ou hors du foyer du contrat`,
        );
      }
      // Archivage réel (Lot 3) : ce chemin ne s'exécute qu'en cas de **changement**
      // de lien (l'idempotence no-op ci-dessus a court-circuité le lien inchangé) →
      // on refuse de (re)pointer un contrat vers une crèche archivée.
      if (!etab.actif) {
        throw new ConflictException(
          'cette crèche est archivée : réactivez-la ou choisissez-en une autre',
        );
      }
      // Met à jour le SEUL lien (pas de remplacement du contrat, pas de cascade
      // planning) — non destructif sur les saisies de planning existantes.
      await tx
        .update(contrat)
        .set({ etablissementId, updatedAt: new Date() })
        .where(eq(contrat.id, contratId));
      const payload: ContratModifiePayload = {
        contratId: ligne.id,
        foyerId: ligne.foyerId,
        enfant: ligne.enfant,
        enfantId: ligne.enfantId,
        mode: ligne.mode as ModeContrat,
        valideDu: ligne.valideDu,
        valideAu: ligne.valideAu,
        etablissementId,
        premiereInscription: ligne.premiereInscription,
      };
      await tx.insert(outbox).values({
        id: randomUUID(),
        type: CONTRAT_MODIFIE_TYPE,
        payload,
        traceId: traceIdCourant(),
      });
      return vue;
    });
  }

  /**
   * Rattache le contrat `contratId` à l'enfant `enfantId` (lien de référence vers
   * l'agrégat `svc-foyer`) **sans remplacer le reste du contrat ni invalider ses
   * plannings** — même geste chirurgical que `rattacherEtablissement`. Dédié au
   * **back-fill** des contrats historiques (`scripts/backfill-enfants.mjs`,
   * rapprochement par prénom au sein du foyer, fait par l'appelant). L'existence
   * de l'enfant n'est PAS vérifiée ici : `svc-planification` ne projette pas les
   * enfants (référence inter-services de confiance, comme `foyerId`).
   *
   * Émet `ContratModifie` (état complet relu depuis la ligne) pour que les
   * read-models aval propagent le lien. **Idempotent** : si le contrat pointe déjà
   * sur cet enfant, no-op (aucune écriture, aucun événement) — un re-run est sûr.
   * 404 si le contrat est introuvable.
   */
  async rattacherEnfant(
    contratId: string,
    enfantId: string,
  ): Promise<ContratVue> {
    return this.db.transaction(async (tx) => {
      const lignes = await tx
        .select()
        .from(contrat)
        .where(eq(contrat.id, contratId));
      const ligne = lignes[0];
      if (!ligne) {
        throw new NotFoundException(`contrat introuvable : ${contratId}`);
      }
      // Idempotence : déjà rattaché à CET enfant → rien à faire.
      if (ligne.enfantId === enfantId) {
        return {
          id: ligne.id,
          foyerId: ligne.foyerId,
          enfant: ligne.enfant,
          enfantId: ligne.enfantId,
          mode: ligne.mode,
          valideDu: ligne.valideDu,
          valideAu: ligne.valideAu,
          premiereInscription: ligne.premiereInscription,
        };
      }
      // Met à jour le SEUL lien (pas de remplacement du contrat, pas de cascade
      // planning) — non destructif sur les saisies de planning existantes.
      await tx
        .update(contrat)
        .set({ enfantId, updatedAt: new Date() })
        .where(eq(contrat.id, contratId));
      const payload: ContratModifiePayload = {
        contratId: ligne.id,
        foyerId: ligne.foyerId,
        enfant: ligne.enfant,
        enfantId,
        mode: ligne.mode as ModeContrat,
        valideDu: ligne.valideDu,
        valideAu: ligne.valideAu,
        etablissementId: ligne.etablissementId,
        premiereInscription: ligne.premiereInscription,
      };
      await tx.insert(outbox).values({
        id: randomUUID(),
        type: CONTRAT_MODIFIE_TYPE,
        payload,
        traceId: traceIdCourant(),
      });
      return {
        id: ligne.id,
        foyerId: ligne.foyerId,
        enfant: ligne.enfant,
        enfantId,
        mode: ligne.mode,
        valideDu: ligne.valideDu,
        valideAu: ligne.valideAu,
        premiereInscription: ligne.premiereInscription,
      };
    });
  }

  /**
   * Supprime un contrat + ses plannings mensuels (cascade) + émet `ContratSupprime`
   * dans la même transaction (outbox). 404 si le contrat n'existe pas.
   */
  async supprimerContrat(id: string): Promise<void> {
    await this.db.transaction(async (tx) => {
      const lignes = await tx.select().from(contrat).where(eq(contrat.id, id));
      if (!lignes[0]) {
        throw new NotFoundException(`contrat introuvable : ${id}`);
      }
      // Cascade explicite des plannings (la FK est aussi en `onDelete: cascade`).
      await tx.delete(planningMois).where(eq(planningMois.contratId, id));
      await tx.delete(contrat).where(eq(contrat.id, id));
      const payload: ContratSupprimePayload = { contratId: id };
      await tx.insert(outbox).values({
        id: randomUUID(),
        type: CONTRAT_SUPPRIME_TYPE,
        payload,
        traceId: traceIdCourant(),
      });
    });
  }

  /** Charge un contrat ou lève 404. Factorisé (lectures hors/dans transaction). */
  private async exigerContrat(
    lecteur: Lecteur,
    contratId: string,
  ): Promise<ContratRow> {
    const lignes = await lecteur
      .select()
      .from(contrat)
      .where(eq(contrat.id, contratId));
    const ligne = lignes[0];
    if (!ligne) {
      throw new NotFoundException(`contrat introuvable : ${contratId}`);
    }
    return ligne;
  }

  /** Charge une version d'un contrat ou lève 404. */
  private async exigerVersion(
    lecteur: Lecteur,
    contratId: string,
    versionId: string,
  ): Promise<ContratVersionRow> {
    const lignes = await lecteur
      .select()
      .from(contratVersion)
      .where(
        and(
          eq(contratVersion.id, versionId),
          eq(contratVersion.contratId, contratId),
        ),
      );
    const ligne = lignes[0];
    if (!ligne) {
      throw new NotFoundException(`version introuvable : ${versionId}`);
    }
    return ligne;
  }

  /** Versions d'un contrat, triées par date d'effet croissante. */
  private async versionsDeContrat(
    lecteur: Lecteur,
    contratId: string,
  ): Promise<ContratVersionRow[]> {
    return lecteur
      .select()
      .from(contratVersion)
      .where(eq(contratVersion.contratId, contratId))
      .orderBy(contratVersion.dateEffet);
  }

  /**
   * Refuse un changement de mode (l'identité n'est pas versionnée, H6) : un
   * avenant/une correction opèrent sur les paramètres, pas sur le mode.
   */
  private exigerModeIdentique(modeDto: string, modeContrat: string): void {
    if (modeDto !== modeContrat) {
      throw new BadRequestException(
        `le mode d'un contrat ne se change pas par avenant (${modeContrat} attendu)`,
      );
    }
  }

  /** Extrait les paramètres versionnés d'un DTO (avenant/correction/corps complet). */
  private champsVersionDepuisDto(dto: {
    mode: ModeContrat;
    heuresAnnuellesContractualisees?: number;
    nbMensualites?: number;
    semaineType?: unknown;
    semaineAbcm?: unknown;
  }): ChampsVersion {
    if (dto.mode === 'CRECHE_PSU') {
      return {
        heuresAnnuellesContractualisees:
          dto.heuresAnnuellesContractualisees ?? null,
        nbMensualites: dto.nbMensualites ?? null,
        semaineType: dto.semaineType ?? null,
        semaineAbcm: null,
      };
    }
    return {
      heuresAnnuellesContractualisees: null,
      nbMensualites: null,
      semaineType: null,
      semaineAbcm: dto.semaineAbcm ?? null,
    };
  }

  /**
   * Valide la cohérence métier des paramètres d'une version via le domaine (comme
   * à la création). Pour la crèche, on reconstruit un `ContratCreche` sur la
   * période `[dateEffet, valideAu]` — toute violation d'invariant (INV-01, heures,
   * mensualités) est levée en `DomainError` → 400 par le filtre global.
   */
  private validerVersionDomaine(
    contratActuel: ContratRow,
    dateEffet: string,
    champs: ChampsVersion,
  ): void {
    if (contratActuel.mode === 'CRECHE_PSU') {
      ContratCreche.creer({
        valideDu: dateEffet,
        // Borne haute de vie du contrat, ou la date d'effet si contrat mono-jour.
        valideAu:
          contratActuel.valideAu !== null && contratActuel.valideAu >= dateEffet
            ? contratActuel.valideAu
            : dateEffet,
        heuresAnnuellesContractualisees:
          champs.heuresAnnuellesContractualisees ?? 0,
        nbMensualites: champs.nbMensualites ?? 1,
        semaineType: semaineTypeDepuisJson(
          (champs.semaineType as SemaineTypeJson | null) ?? {},
        ),
      });
    }
  }

  /**
   * Résout la version **courante** (applicable aujourd'hui) d'une suite non vide,
   * ou, si toutes sont futures (contrat pas encore commencé), la plus proche (la
   * première par date d'effet). Sert la projection sur `contrat` et la façade
   * `version-courante`.
   */
  private resoudreVersionCourante(
    versions: readonly ContratVersionRow[],
  ): ContratVersionRow {
    const suite = depuisSuite(
      versions.map((v) => ({ dateEffet: v.dateEffet, valeur: v })),
    );
    try {
      return selectionnerVersionApplicable(suite, aujourdhuiIso()).valeur;
    } catch {
      // Aujourd'hui antérieur à la 1ʳᵉ date d'effet : projeter la plus proche.
      return [...versions].sort((a, b) =>
        a.dateEffet < b.dateEffet ? -1 : 1,
      )[0]!;
    }
  }

  /**
   * **Piège du lot** : réécrit les colonnes-projection de `contrat` (paramètres
   * versionnés) depuis la version courante — à appeler après toute création/
   * correction de version dont la période peut couvrir aujourd'hui, sinon les
   * read-models aval et l'UI listent des paramètres périmés. No-op si le contrat
   * n'a aucune version (défensif — n'arrive pas après le back-fill).
   */
  private async rafraichirProjectionContrat(
    tx: Tx,
    contratId: string,
  ): Promise<void> {
    const versions = await this.versionsDeContrat(tx, contratId);
    if (versions.length === 0) {
      return;
    }
    const courante = this.resoudreVersionCourante(versions);
    await tx
      .update(contrat)
      .set({
        heuresAnnuellesContractualisees:
          courante.heuresAnnuellesContractualisees,
        nbMensualites: courante.nbMensualites,
        semaineType: courante.semaineType,
        semaineAbcm: courante.semaineAbcm,
        updatedAt: new Date(),
      })
      .where(eq(contrat.id, contratId));
  }

  /**
   * Écrase les paramètres versionnés d'une version (correction), journalise
   * l'avant/après (`correction_journal`, D6), rafraîchit la projection de la
   * version courante et émet `ContratModifie`. Partagé par `corrigerVersion` et
   * `corrigerVersionCourante`.
   */
  private async appliquerCorrection(
    tx: Tx,
    contratActuel: ContratRow,
    version: ContratVersionRow,
    champs: ChampsVersion,
    motif: string | null,
  ): Promise<void> {
    const avant: ChampsVersion = {
      heuresAnnuellesContractualisees: version.heuresAnnuellesContractualisees,
      nbMensualites: version.nbMensualites,
      semaineType: version.semaineType,
      semaineAbcm: version.semaineAbcm,
    };
    await tx
      .update(contratVersion)
      .set({ ...champs, motif, updatedAt: new Date() })
      .where(eq(contratVersion.id, version.id));
    await tx.insert(correctionJournal).values({
      id: randomUUID(),
      contratId: contratActuel.id,
      versionId: version.id,
      avant,
      apres: champs,
      motif,
    });
    await this.rafraichirProjectionContrat(tx, contratActuel.id);
    await this.emettreContratModifie(tx, contratActuel, {
      id: version.id,
      dateEffet: version.dateEffet,
    });
  }

  /**
   * Émet `ContratModifie.v2` (état cœur + `versionId`/`dateEffet` de la version
   * créée ou corrigée, RM-30-06) via l'outbox pour que les read-models aval
   * (`svc-tarification`, `svc-notifications`) se mettent à jour. Le payload ne
   * transporte pas les paramètres versionnés (les projections n'en ont pas besoin).
   */
  private async emettreContratModifie(
    tx: Tx,
    contratActuel: ContratRow,
    version: { id: string; dateEffet: string },
  ): Promise<void> {
    const payload: ContratModifieV2Payload = {
      contratId: contratActuel.id,
      foyerId: contratActuel.foyerId,
      enfant: contratActuel.enfant,
      enfantId: contratActuel.enfantId,
      mode: contratActuel.mode as ModeContrat,
      valideDu: contratActuel.valideDu,
      valideAu: contratActuel.valideAu,
      etablissementId: contratActuel.etablissementId,
      premiereInscription: contratActuel.premiereInscription,
      versionId: version.id,
      dateEffet: version.dateEffet,
    };
    await tx.insert(outbox).values({
      id: randomUUID(),
      type: CONTRAT_MODIFIE_V2_TYPE,
      payload,
      traceId: traceIdCourant(),
    });
  }

  /**
   * Résout le **lien établissement** d'un contrat dans la transaction `tx` (P2) et
   * renvoie l'`etablissementId` à stocker (toujours non-null depuis P5) :
   * - `nouvelEtablissement` fourni → **crée** l'établissement (insert + émet
   *   `EtablissementCree` via l'outbox) DANS la même transaction → atomicité : un
   *   rollback du contrat annule aussi l'établissement (pas d'établissement fantôme).
   * - `etablissementId` fourni → **vérifie** qu'il existe ET appartient au
   *   `foyerId` du contrat (isolation inter-foyers) → 400 sinon. **Refuse** de
   *   rattacher un établissement **archivé** (409) — sauf **tolérance « lien
   *   inchangé »** : si le contrat pointe **déjà** sur cet archivé (`etablissementActuel`
   *   égal), on tolère (édition d'autres champs) ; on ne rejette que sur un **changement**
   *   vers un archivé (ou toute création, où `etablissementActuel` est `undefined`).
   *
   * `etablissementActuel` = lien actuel du contrat (chemin `modifier`) ; `undefined` à
   * la création. La **création à la volée** (`nouvelEtablissement`) crée toujours un
   * `actif` → jamais concernée par le rejet archivé.
   *
   * Le DTO garantit qu'**exactement un** des deux champs est fourni (refine Zod) :
   * la colonne étant `NOT NULL` (P5), un contrat sans établissement est rejeté en
   * amont. Le `throw` final est une défense en profondeur (chemin théoriquement mort).
   */
  private async resoudreEtablissement(
    tx: Tx,
    foyerId: string,
    dto: CreerContratDto,
    etablissementActuel?: string | null,
  ): Promise<string> {
    if (dto.nouvelEtablissement) {
      const nouvel = dto.nouvelEtablissement;
      // Idempotence de la création à la volée (chantier « Confiance », lot 3 — C1) :
      // l'`id` d'un établissement créé au vol est régénéré à chaque tentative, la
      // dédup se fait donc sur `UNIQUE(foyer_id, nom)` (`onConflictDoNothing`). Au
      // rejeu d'un POST contrat, la 1ʳᵉ tentative a déjà créé l'établissement →
      // l'insert ne renvoie rien : on relie le contrat à l'établissement EXISTANT
      // du foyer (par nom), SANS second `EtablissementCree`. C'est ce qui remplace
      // le 23505 mensonger d'avant (qui faisait échouer le contrat au retry).
      const insere = await tx
        .insert(etablissement)
        .values({
          id: randomUUID(),
          foyerId,
          nom: nouvel.nom,
          emailService: nouvel.emailService ?? null,
          preavisRegle: nouvel.preavisRegle ?? null,
          types: nouvel.types ?? [],
          adresse: nouvel.adresse ?? null,
          telephone: nouvel.telephone ?? null,
          contact: nouvel.contact ?? null,
          actif: nouvel.actif ?? true,
        })
        .onConflictDoNothing({
          target: [etablissement.foyerId, etablissement.nom],
        })
        .returning();
      const ligne = insere[0];
      if (ligne) {
        // Vraie création : projeté tel quel (état complet) pour le read-model
        // notifications (P3) ; les coordonnées internes (adresse/téléphone/contact)
        // ne voyagent pas.
        const payload: EtablissementCreePayload = {
          etablissementId: ligne.id,
          foyerId: ligne.foyerId,
          nom: ligne.nom,
          emailService: ligne.emailService,
          preavisRegle: ligne.preavisRegle,
          types: ligne.types,
          actif: ligne.actif,
        };
        await tx.insert(outbox).values({
          id: randomUUID(),
          type: ETABLISSEMENT_CREE_TYPE,
          payload,
          traceId: traceIdCourant(),
        });
        return ligne.id;
      }
      // Collision de nom (rejeu / concurrence) : réutiliser l'établissement du foyer.
      const existants = await tx
        .select()
        .from(etablissement)
        .where(
          and(
            eq(etablissement.foyerId, foyerId),
            eq(etablissement.nom, nouvel.nom),
          ),
        );
      const existant = existants[0];
      if (!existant) {
        throw new Error(`insertion établissement échouée (foyer ${foyerId})`);
      }
      return existant.id;
    }

    if (dto.etablissementId !== undefined) {
      const lignes = await tx
        .select()
        .from(etablissement)
        .where(
          and(
            eq(etablissement.id, dto.etablissementId),
            eq(etablissement.foyerId, foyerId),
          ),
        );
      const ligne = lignes[0];
      if (!ligne) {
        throw new BadRequestException(
          `établissement ${dto.etablissementId} inconnu ou hors du foyer du contrat`,
        );
      }
      // Archivage réel (Lot 3) : on n'accepte pas de rattacher un contrat à une crèche
      // archivée, SAUF si le lien est **inchangé** (le contrat pointait déjà dessus —
      // édition d'autres champs). Un changement vers un archivé, ou toute création
      // (`etablissementActuel` undefined), est refusé.
      if (!ligne.actif && dto.etablissementId !== etablissementActuel) {
        throw new ConflictException(
          'cette crèche est archivée : réactivez-la ou choisissez-en une autre',
        );
      }
      return dto.etablissementId;
    }

    // Inatteignable si le DTO a été validé (refine « exactement un »), mais on
    // refuse explicitement plutôt que d'insérer un `etablissement_id` NULL (P5).
    throw new BadRequestException(
      'établissement requis : fournir etablissementId (existant) ou nouvelEtablissement (création)',
    );
  }

  /**
   * Enregistre (ou remplace) le planning d'un mois pour un contrat (réel ou
   * simulé) + émet `PlanningModifie` dans la même transaction (outbox).
   */
  async ecrirePlanning(
    contratId: string,
    mois: string,
    simule: boolean,
    dto: EcrirePlanningDto,
  ): Promise<void> {
    await this.db.transaction(async (tx) => {
      const lignes = await tx
        .select()
        .from(contrat)
        .where(eq(contrat.id, contratId));
      if (!lignes[0]) {
        throw new NotFoundException(`contrat introuvable : ${contratId}`);
      }
      await this.upsertPlanningMois(tx, contratId, mois, simule, dto);
    });
  }

  /**
   * Cœur de l'écriture d'un planning mensuel **dans une transaction `tx` déjà
   * ouverte** (la garde 404 du contrat est à la charge de l'appelant) : upsert
   * idempotent du mois (`onConflictDoUpdate`) + émission de `PlanningModifie` via
   * l'outbox **dans la même transaction**. Partagé par `ecrirePlanning` (un mois)
   * et `ecrireSemaine` (les N mois d'une semaine, tous dans une seule transaction)
   * pour garantir l'atomicité mois-par-mois **et** semaine-à-cheval.
   */
  private async upsertPlanningMois(
    tx: Tx,
    contratId: string,
    mois: string,
    simule: boolean,
    dto: EcrirePlanningDto,
  ): Promise<void> {
    await tx
      .insert(planningMois)
      .values({ contratId, mois, simule, saisie: dto, updatedAt: new Date() })
      .onConflictDoUpdate({
        target: [
          planningMois.contratId,
          planningMois.mois,
          planningMois.simule,
        ],
        set: { saisie: dto, updatedAt: new Date() },
      });
    const payload: PlanningModifiePayload = { contratId, mois, simule };
    await tx.insert(outbox).values({
      id: randomUUID(),
      type: PLANNING_MODIFIE_TYPE,
      payload,
      traceId: traceIdCourant(),
    });
  }

  /**
   * Lit la saisie enregistrée d'un mois **dans la transaction `tx`** (réelle ou
   * simulée), sans garde d'existence du contrat (l'appelant l'a déjà vérifiée).
   * Renvoie `null` si aucune saisie n'existe pour ce couple (contrat, mois,
   * simulé). Variante transactionnelle de `lirePlanning` : `ecrireSemaine` doit
   * relire chaque mois dans la MÊME transaction que ses upserts (lecture cohérente
   * + atomicité de bout en bout).
   */
  private async lireSaisieMois(
    tx: Tx,
    contratId: string,
    mois: string,
    simule: boolean,
  ): Promise<EcrirePlanningDto | null> {
    const plannings = await tx
      .select()
      .from(planningMois)
      .where(
        and(
          eq(planningMois.contratId, contratId),
          eq(planningMois.mois, mois),
          eq(planningMois.simule, simule),
        ),
      );
    return (plannings[0]?.saisie as EcrirePlanningDto | undefined) ?? null;
  }

  /**
   * Enregistre une **édition limitée à une semaine** sans écraser le reste du
   * mois. Le planning est stocké par mois et l'upsert remplace tout le mois : on
   * relit donc chaque mois recouvert par la semaine, on **fusionne** la part de la
   * semaine appartenant à CE mois (préserve les autres jours, les scalaires
   * mensuels et l'autre mois), puis on ré-upsert (émet `PlanningModifie` par mois).
   *
   * **Atomicité bout-en-bout** : les N mois recouverts (1, ou **2** pour une
   * semaine à cheval) sont relus ET ré-upsertés dans **UNE seule transaction**
   * (`db.transaction`). Un crash entre les deux mois ne peut donc pas laisser la
   * semaine à moitié écrite (les deux upserts + les deux events sont annulés
   * ensemble par le rollback) — ce qui évite aussi tout snapshot de notification
   * divergent. On conserve **un événement `PlanningModifie` par mois modifié** (les
   * consommateurs aval sont keyed par mois). 404 si le contrat n'existe pas.
   */
  async ecrireSemaine(
    contratId: string,
    semaineIso: string,
    simule: boolean,
    besoins: BesoinsSemaine,
  ): Promise<void> {
    const jours = joursDeLaSemaine(semaineIso);
    const moisCouverts = moisDeLaSemaine(semaineIso);
    await this.db.transaction(async (tx) => {
      // Garde 404 une seule fois pour toute la semaine (au lieu d'un contrôle par
      // mois) : l'existence du contrat vaut pour tous les mois recouverts.
      const lignes = await tx
        .select()
        .from(contrat)
        .where(eq(contrat.id, contratId));
      if (!lignes[0]) {
        throw new NotFoundException(`contrat introuvable : ${contratId}`);
      }
      for (const mois of moisCouverts) {
        const joursDuMois = jours.filter((jour) => jour.slice(0, 7) === mois);
        const courant = await this.lireSaisieMois(tx, contratId, mois, simule);
        const fusion = fusionnerSemaineDansMois(courant, joursDuMois, besoins);
        await this.upsertPlanningMois(tx, contratId, mois, simule, fusion);
      }
    });
  }

  /**
   * Lit la saisie de planning enregistrée d'un mois (réelle ou simulée), telle
   * que stockée (forme `EcrirePlanningDto`). Renvoie `null` si aucune saisie n'a
   * été enregistrée pour ce couple (contrat, mois, simulé). 404 si le contrat
   * n'existe pas. Permet à l'app de réhydrater les calendriers depuis le serveur
   * (durabilité multi-poste), au lieu de ne s'appuyer que sur le navigateur.
   */
  async lirePlanning(
    contratId: string,
    mois: string,
    simule: boolean,
  ): Promise<EcrirePlanningDto | null> {
    const contrats = await this.db
      .select()
      .from(contrat)
      .where(eq(contrat.id, contratId));
    if (!contrats[0]) {
      throw new NotFoundException(`contrat introuvable : ${contratId}`);
    }
    const plannings = await this.db
      .select()
      .from(planningMois)
      .where(
        and(
          eq(planningMois.contratId, contratId),
          eq(planningMois.mois, mois),
          eq(planningMois.simule, simule),
        ),
      );
    return (plannings[0]?.saisie as EcrirePlanningDto | undefined) ?? null;
  }

  /**
   * Génère les **prestations du mois** d'un contrat (cœur de la DoD). Lit la saisie
   * enregistrée (réelle ou simulée), récupère les jours non facturables du
   * Référentiel (INV-04) et délègue la génération au domaine pur.
   */
  async prestationsMois(
    contratId: string,
    mois: string,
    simule: boolean,
  ): Promise<PlanningMensuel> {
    const lignes = await this.db
      .select()
      .from(contrat)
      .where(eq(contrat.id, contratId));
    const ligne = lignes[0];
    if (!ligne) {
      throw new NotFoundException(`contrat introuvable : ${contratId}`);
    }

    const plannings = await this.db
      .select()
      .from(planningMois)
      .where(
        and(
          eq(planningMois.contratId, contratId),
          eq(planningMois.mois, mois),
          eq(planningMois.simule, simule),
        ),
      );
    const saisie =
      (plannings[0]?.saisie as EcrirePlanningDto | undefined) ?? {};
    const joursNonFacturables = await this.referentiel.joursNonFacturables();

    // Résolution temporelle (SFD 30 lot 4) : construit les **segments** (versions)
    // couvrant le mois, chacun restreint à sa période effective, puis délègue la
    // génération segmentée au domaine pur (semaine type jour par jour, mensualité
    // au 1er du mois — H7). Un seul segment = comportement historique inchangé.
    const versions = await this.versionsDeContrat(this.db, contratId);
    const segments = this.construireSegments(ligne, versions, mois);
    const prestation = genererPrestationMoisSegments(
      segments,
      mois,
      saisie,
      joursNonFacturables,
    );
    return { mois, prestations: [prestation] };
  }

  /**
   * Construit les segments de génération d'un mois : une entrée par version dont
   * la période (dérivée par le socle : `[dateEffet, veille de la suivante]`, dernière
   * ouverte) **intersecte** à la fois la vie du contrat et le mois. Chaque segment
   * porte un `ContratPourGeneration` dont `valideDu`/`valideAu` sont l'intersection
   * (le domaine ne génère alors que les jours du segment). Repli **défensif** : un
   * contrat sans version (jamais après le back-fill) retombe sur ses colonnes-
   * projection en un unique segment (comportement d'avant le versionnement).
   */
  private construireSegments(
    ligne: ContratRow,
    versions: readonly ContratVersionRow[],
    mois: string,
  ): ContratPourGeneration[] {
    const base = (champs: ChampsVersion): ContratPourGeneration => ({
      mode: ligne.mode,
      valideDu: ligne.valideDu,
      valideAu: ligne.valideAu,
      heuresAnnuellesContractualisees: champs.heuresAnnuellesContractualisees,
      nbMensualites: champs.nbMensualites,
      semaineType: champs.semaineType as SemaineTypeJson | null,
      semaineAbcm: champs.semaineAbcm as SemaineTypeAbcm | null,
    });

    if (versions.length === 0) {
      return [
        base({
          heuresAnnuellesContractualisees:
            ligne.heuresAnnuellesContractualisees,
          nbMensualites: ligne.nbMensualites,
          semaineType: ligne.semaineType,
          semaineAbcm: ligne.semaineAbcm,
        }),
      ];
    }

    const finContrat = ligne.valideAu; // borne haute de vie (null = ouvert)
    const debutMois = `${mois}-01`;
    const finMois = derniereDateDuMois(mois);
    const periodes = depuisSuite(
      versions.map((v) => ({ dateEffet: v.dateEffet, valeur: v })),
    );

    const segments: ContratPourGeneration[] = [];
    for (const p of periodes) {
      // Intersection période de version × vie du contrat × mois.
      const finVersion = p.periode.au; // null = ouvert
      const bornesHautes = [finMois, finContrat, finVersion].filter(
        (d): d is string => d !== null,
      );
      const au = bornesHautes.reduce((min, d) => (d < min ? d : min));
      const du = [debutMois, ligne.valideDu, p.periode.du].reduce((max, d) =>
        d > max ? d : max,
      );
      if (du > au) {
        continue; // ce segment ne couvre aucun jour du mois
      }
      segments.push({
        ...base({
          heuresAnnuellesContractualisees:
            p.valeur.heuresAnnuellesContractualisees,
          nbMensualites: p.valeur.nbMensualites,
          semaineType: p.valeur.semaineType,
          semaineAbcm: p.valeur.semaineAbcm,
        }),
        valideDu: du,
        valideAu: au,
      });
    }

    // Aucun segment ne couvre le mois (mois hors vie du contrat) : un segment
    // « courant » vide donne les quantités nulles attendues (couvreMois faux).
    if (segments.length === 0) {
      const courante = this.resoudreVersionCourante(versions);
      return [
        base({
          heuresAnnuellesContractualisees:
            courante.heuresAnnuellesContractualisees,
          nbMensualites: courante.nbMensualites,
          semaineType: courante.semaineType,
          semaineAbcm: courante.semaineAbcm,
        }),
      ];
    }
    return segments;
  }
}
