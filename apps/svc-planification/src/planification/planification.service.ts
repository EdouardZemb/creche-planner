import { randomUUID } from 'node:crypto';
import {
  BadRequestException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { and, eq } from 'drizzle-orm';
import { Duree } from '@creche-planner/shared-kernel';
import {
  ContratCreche,
  InscriptionAbcm,
  PlageHoraire,
  SemaineType,
  type AbsenceCreche,
  type ExceptionJour,
  type JourAlsh,
  type JourSupplementaireCreche,
  type PlanningMensuel,
  type PrestationMois,
  type SaisieGenerationAlsh,
  type SaisieGenerationCantine,
  type SaisieGenerationCreche,
  type SaisieGenerationPeriscolaire,
  type SaisieSemaineType,
  type SemaineTypeAbcm,
} from '@creche-planner/planification-domain';
import {
  CONTRAT_CREE_TYPE,
  CONTRAT_MODIFIE_TYPE,
  CONTRAT_SUPPRIME_TYPE,
  ETABLISSEMENT_CREE_TYPE,
  PLANNING_MODIFIE_TYPE,
  type ContratCreePayload,
  type ContratModifiePayload,
  type ContratSupprimePayload,
  type EtablissementCreePayload,
  type ModeContrat,
  type PlanningModifiePayload,
} from '@creche-planner/contracts-planification';
import { DRIZZLE, traceIdCourant } from '@creche-planner/nest-commons';
import type { Database } from '../database/database.types.js';
import {
  contrat,
  etablissement,
  outbox,
  planningMois,
  type ContratRow,
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
  CreerContratDto,
  EcrirePlanningDto,
  ModifierContratDto,
} from './planification.dto.js';

/** Projection lisible d'un contrat. */
export interface ContratVue {
  readonly id: string;
  readonly foyerId: string;
  readonly enfant: string;
  readonly mode: string;
  readonly valideDu: string;
  readonly valideAu: string | null;
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

/** Forme JSON de la semaine type crèche stockée en base. */
interface PlageJson {
  readonly debutHeures: number;
  readonly debutMinutes: number;
  readonly finHeures: number;
  readonly finMinutes: number;
}
type SemaineTypeJson = Record<string, PlageJson[]>;

/** Plage horaire (heures/minutes d'arrivée et de départ). */
interface PlageHeures {
  readonly debutHeures: number;
  readonly debutMinutes: number;
  readonly finHeures: number;
  readonly finMinutes: number;
}

/** Durée d'une plage (fin − début) ; `zero` si la plage est incohérente. */
function dureeDePlage(p: PlageHeures): Duree {
  const debut = p.debutHeures * 60 + p.debutMinutes;
  const fin = p.finHeures * 60 + p.finMinutes;
  return fin > debut ? Duree.depuisMinutes(fin - debut) : Duree.zero();
}

/** Transaction Drizzle (le `tx` passé au callback de `db.transaction`). */
type Tx = Parameters<Parameters<Database['transaction']>[0]>[0];

@Injectable()
export class PlanificationService {
  constructor(
    @Inject(DRIZZLE) private readonly db: Database,
    private readonly referentiel: ReferentielClient,
  ) {}

  /** Crée un contrat + émet `ContratCree` dans la même transaction (outbox). */
  async creerContrat(dto: CreerContratDto): Promise<ContratVue> {
    // Valide la cohérence métier via le domaine avant de persister.
    if (dto.mode === 'CRECHE_PSU') {
      ContratCreche.creer({
        valideDu: dto.valideDu,
        valideAu: dto.valideAu ?? dto.valideDu,
        heuresAnnuellesContractualisees: dto.heuresAnnuellesContractualisees,
        nbMensualites: dto.nbMensualites,
        semaineType: this.semaineTypeDepuisJson(dto.semaineType),
      });
    }

    const id = randomUUID();
    await this.db.transaction(async (tx) => {
      // Résout le lien établissement DANS la même transaction (atomicité : pas de
      // contrat orphelin ni d'établissement fantôme — cf. `resoudreEtablissement`).
      const etablissementId = await this.resoudreEtablissement(
        tx,
        dto.foyerId,
        dto,
      );
      await tx.insert(contrat).values({
        id,
        foyerId: dto.foyerId,
        enfant: dto.enfant,
        mode: dto.mode,
        etablissementId,
        valideDu: dto.valideDu,
        valideAu: dto.valideAu,
        heuresAnnuellesContractualisees:
          dto.mode === 'CRECHE_PSU'
            ? dto.heuresAnnuellesContractualisees
            : null,
        nbMensualites: dto.mode === 'CRECHE_PSU' ? dto.nbMensualites : null,
        semaineType: dto.mode === 'CRECHE_PSU' ? dto.semaineType : null,
        semaineAbcm: dto.mode === 'CRECHE_PSU' ? null : dto.semaineAbcm,
      });
      const payload: ContratCreePayload = {
        contratId: id,
        foyerId: dto.foyerId,
        enfant: dto.enfant,
        mode: dto.mode,
        valideDu: dto.valideDu,
        valideAu: dto.valideAu,
        etablissementId,
      };
      await tx.insert(outbox).values({
        id: randomUUID(),
        type: CONTRAT_CREE_TYPE,
        payload,
        traceId: traceIdCourant(),
      });
    });

    return {
      id,
      foyerId: dto.foyerId,
      enfant: dto.enfant,
      mode: dto.mode,
      valideDu: dto.valideDu,
      valideAu: dto.valideAu,
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
      mode: l.mode,
      etablissementId: l.etablissementId,
      valideDu: l.valideDu,
      valideAu: l.valideAu,
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
      mode: ligne.mode,
      valideDu: ligne.valideDu,
      valideAu: ligne.valideAu,
    };
  }

  /**
   * Met à jour les champs d'un contrat (enfant, mode, dates de validité, semaine
   * type / inscriptions, heures, nbMensualités selon le mode) + émet `ContratModifie`
   * dans la même transaction (outbox). **Cascade** : les plannings mensuels saisis
   * (`planning_mois`) sont invalidés (supprimés), car le changement de mode/dates les
   * rend incohérents — ils seront ressaisis. 404 si le contrat n'existe pas.
   */
  async modifierContrat(
    id: string,
    dto: ModifierContratDto,
  ): Promise<ContratVue> {
    // Valide la cohérence métier via le domaine avant de persister (comme à la création).
    if (dto.mode === 'CRECHE_PSU') {
      ContratCreche.creer({
        valideDu: dto.valideDu,
        valideAu: dto.valideAu ?? dto.valideDu,
        heuresAnnuellesContractualisees: dto.heuresAnnuellesContractualisees,
        nbMensualites: dto.nbMensualites,
        semaineType: this.semaineTypeDepuisJson(dto.semaineType),
      });
    }

    await this.db.transaction(async (tx) => {
      const lignes = await tx.select().from(contrat).where(eq(contrat.id, id));
      if (!lignes[0]) {
        throw new NotFoundException(`contrat introuvable : ${id}`);
      }
      // Résout le lien établissement dans la même transaction (existant validé /
      // nouvel établissement créé atomiquement). Le DTO étant un remplacement
      // complet, l'absence des deux champs vaut « pas d'établissement » (null).
      const etablissementId = await this.resoudreEtablissement(
        tx,
        dto.foyerId,
        dto,
      );
      await tx
        .update(contrat)
        .set({
          foyerId: dto.foyerId,
          enfant: dto.enfant,
          mode: dto.mode,
          etablissementId,
          valideDu: dto.valideDu,
          valideAu: dto.valideAu,
          heuresAnnuellesContractualisees:
            dto.mode === 'CRECHE_PSU'
              ? dto.heuresAnnuellesContractualisees
              : null,
          nbMensualites: dto.mode === 'CRECHE_PSU' ? dto.nbMensualites : null,
          semaineType: dto.mode === 'CRECHE_PSU' ? dto.semaineType : null,
          semaineAbcm: dto.mode === 'CRECHE_PSU' ? null : dto.semaineAbcm,
          updatedAt: new Date(),
        })
        .where(eq(contrat.id, id));
      // Invalide les plannings saisis : le changement de mode/dates les rend
      // incohérents (un planning crèche n'a pas de sens pour un contrat cantine).
      await tx.delete(planningMois).where(eq(planningMois.contratId, id));
      const payload: ContratModifiePayload = {
        contratId: id,
        foyerId: dto.foyerId,
        enfant: dto.enfant,
        mode: dto.mode,
        valideDu: dto.valideDu,
        valideAu: dto.valideAu,
        etablissementId,
      };
      await tx.insert(outbox).values({
        id: randomUUID(),
        type: CONTRAT_MODIFIE_TYPE,
        payload,
        traceId: traceIdCourant(),
      });
    });

    return {
      id,
      foyerId: dto.foyerId,
      enfant: dto.enfant,
      mode: dto.mode,
      valideDu: dto.valideDu,
      valideAu: dto.valideAu,
    };
  }

  /**
   * Rattache le contrat `contratId` à l'établissement `etablissementId` (lien P2)
   * **sans remplacer le reste du contrat ni invalider ses plannings** — à la
   * différence de `modifierContrat` (remplacement complet + cascade `planning_mois`).
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
        mode: ligne.mode,
        valideDu: ligne.valideDu,
        valideAu: ligne.valideAu,
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
      if (!etabs[0]) {
        throw new BadRequestException(
          `établissement ${etablissementId} inconnu ou hors du foyer du contrat`,
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
        mode: ligne.mode as ModeContrat,
        valideDu: ligne.valideDu,
        valideAu: ligne.valideAu,
        etablissementId,
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

  /**
   * Résout le **lien établissement** d'un contrat dans la transaction `tx` (P2) et
   * renvoie l'`etablissementId` à stocker (ou `null` si aucun lien fourni) :
   * - `nouvelEtablissement` fourni → **crée** l'établissement (insert + émet
   *   `EtablissementCree` via l'outbox) DANS la même transaction → atomicité : un
   *   rollback du contrat annule aussi l'établissement (pas d'établissement fantôme).
   * - `etablissementId` fourni → **vérifie** qu'il existe ET appartient au
   *   `foyerId` du contrat (isolation inter-foyers) → 400 sinon.
   * - aucun des deux → `null` (la colonne `etablissement_id` est NULLABLE jusqu'à P5).
   *
   * Le DTO garantit l'exclusivité des deux champs (refine Zod), inutile de la
   * re-vérifier ici.
   */
  private async resoudreEtablissement(
    tx: Tx,
    foyerId: string,
    dto: CreerContratDto,
  ): Promise<string | null> {
    if (dto.nouvelEtablissement) {
      const nouvel = dto.nouvelEtablissement;
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
        .returning();
      const ligne = insere[0];
      if (!ligne) {
        throw new Error(`insertion établissement échouée (foyer ${foyerId})`);
      }
      // Projeté tel quel (état complet) pour le read-model notifications (P3) ;
      // les coordonnées internes (adresse/téléphone/contact) ne voyagent pas.
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
      if (!lignes[0]) {
        throw new BadRequestException(
          `établissement ${dto.etablissementId} inconnu ou hors du foyer du contrat`,
        );
      }
      return dto.etablissementId;
    }

    return null;
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
    });
  }

  /**
   * Enregistre une **édition limitée à une semaine** sans écraser le reste du
   * mois. Le planning est stocké par mois et `ecrirePlanning` remplace tout le
   * mois : on relit donc chaque mois recouvert par la semaine, on **fusionne** la
   * part de la semaine appartenant à CE mois (préserve les autres jours, les
   * scalaires mensuels et l'autre mois), puis on ré-upsert (réutilise le chemin
   * `ecrirePlanning` → émet `PlanningModifie`). Une semaine à cheval sur deux mois
   * ⇒ deux upserts + deux events (atomique par mois). 404 si le contrat n'existe pas.
   */
  async ecrireSemaine(
    contratId: string,
    semaineIso: string,
    simule: boolean,
    besoins: BesoinsSemaine,
  ): Promise<void> {
    const jours = joursDeLaSemaine(semaineIso);
    for (const mois of moisDeLaSemaine(semaineIso)) {
      const joursDuMois = jours.filter((jour) => jour.slice(0, 7) === mois);
      // `lirePlanning` garde aussi l'existence du contrat (404 sinon).
      const courant = await this.lirePlanning(contratId, mois, simule);
      const fusion = fusionnerSemaineDansMois(courant, joursDuMois, besoins);
      await this.ecrirePlanning(contratId, mois, simule, fusion);
    }
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

    const prestation = this.genererPrestation(
      ligne,
      mois,
      saisie,
      joursNonFacturables,
    );
    return { mois, prestations: [prestation] };
  }

  /** Aiguille vers le générateur du domaine selon le mode du contrat. */
  private genererPrestation(
    ligne: ContratRow,
    mois: string,
    saisie: EcrirePlanningDto,
    joursNonFacturables: readonly string[],
  ): PrestationMois {
    if (ligne.mode === 'CRECHE_PSU') {
      const contratCreche = ContratCreche.creer({
        valideDu: ligne.valideDu,
        valideAu: ligne.valideAu ?? ligne.valideDu,
        heuresAnnuellesContractualisees:
          ligne.heuresAnnuellesContractualisees ?? 0,
        nbMensualites: ligne.nbMensualites ?? 1,
        semaineType: this.semaineTypeDepuisJson(
          (ligne.semaineType as SemaineTypeJson | null) ?? {},
        ),
      });
      const saisieCreche: SaisieGenerationCreche = {
        mois,
        complement:
          saisie.complementMinutes !== undefined
            ? Duree.depuisMinutes(saisie.complementMinutes)
            : Duree.zero(),
        joursSupplementaires: (saisie.joursSupplementaires ?? [])
          .map(
            (j): JourSupplementaireCreche => ({
              date: j.date,
              duree: dureeDePlage(j),
            }),
          )
          // Plage incohérente (fin ≤ début) → durée nulle, ignorée (sans complément).
          .filter((j) => !j.duree.estZero()),
        absences: (saisie.absences ?? []).map(
          (a): AbsenceCreche => ({
            ...(a.date !== undefined ? { date: a.date } : {}),
            duree: dureeDePlage(a),
            preavisJours: a.preavisJours,
            certificatMaladie: a.certificatMaladie,
          }),
        ),
        joursNonFacturables,
      };
      return contratCreche.genererPrestationsMois(saisieCreche);
    }

    const inscription = InscriptionAbcm.creer({
      semaine: (ligne.semaineAbcm as SemaineTypeAbcm | null) ?? {},
      valideDu: ligne.valideDu,
      ...(ligne.valideAu !== null ? { valideAu: ligne.valideAu } : {}),
    });
    const exceptions = (saisie.exceptions ?? []).map(
      (e): ExceptionJour => ({
        date: e.date,
        ...(e.cantine !== undefined ? { cantine: e.cantine } : {}),
        ...(e.periMatin !== undefined ? { periMatin: e.periMatin } : {}),
        ...(e.periSoir !== undefined ? { periSoir: e.periSoir } : {}),
      }),
    );
    if (ligne.mode === 'CANTINE') {
      const saisieCantine: SaisieGenerationCantine = {
        mois,
        pai: saisie.pai ?? false,
        exceptions,
        joursNonFacturables,
      };
      return inscription.genererPrestationsCantine(saisieCantine);
    }
    if (ligne.mode === 'PERISCOLAIRE') {
      const saisiePeri: SaisieGenerationPeriscolaire = {
        mois,
        exceptions,
        joursNonFacturables,
      };
      return inscription.genererPrestationsPeriscolaire(saisiePeri);
    }
    const saisieAlsh: SaisieGenerationAlsh = {
      mois,
      joursAlsh: (saisie.joursAlsh ?? []).map(
        (j): JourAlsh => ({
          date: j.date,
          type: j.type,
          ...(j.repas !== undefined ? { repas: j.repas } : {}),
        }),
      ),
      joursNonFacturables,
    };
    return inscription.genererPrestationsAlsh(saisieAlsh);
  }

  /** Reconstruit la `SemaineType` du domaine depuis sa forme JSON stockée. */
  private semaineTypeDepuisJson(json: SemaineTypeJson): SemaineType {
    const saisie: SaisieSemaineType = {};
    for (const [jour, plages] of Object.entries(json)) {
      (saisie as Record<string, PlageHoraire[]>)[jour] = plages.map((p) =>
        PlageHoraire.creer(
          p.debutHeures,
          p.debutMinutes,
          p.finHeures,
          p.finMinutes,
        ),
      );
    }
    return SemaineType.creer(saisie);
  }
}
