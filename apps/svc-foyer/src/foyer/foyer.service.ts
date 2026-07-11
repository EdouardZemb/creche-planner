import { randomUUID } from 'node:crypto';
import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { and, asc, eq, sql } from 'drizzle-orm';
import { Money, Tranche } from '@creche-planner/shared-kernel';
import { Enfant, Foyer } from '@creche-planner/foyer-domain';
import {
  ENFANT_AJOUTE_TYPE,
  ENFANT_MODIFIE_TYPE,
  ENFANT_RETIRE_TYPE,
  FOYER_MIS_A_JOUR_TYPE,
  PARENT_AJOUTE_TYPE,
  PARENT_MODIFIE_TYPE,
  PARENT_RETIRE_TYPE,
  PREFERENCES_NOTIF_MODIFIEES_TYPE,
  enfantIdSchema,
  foyerIdSchema,
  parentIdSchema,
  type EnfantAjoutePayload,
  type EnfantModifiePayload,
  type EnfantRetirePayload,
  type FoyerId,
  type FoyerMisAJourPayload,
  type ParentAjoutePayload,
  type ParentRetirePayload,
} from '@creche-planner/contracts-foyer';
import { DRIZZLE, traceIdCourant } from '@creche-planner/nest-commons';
import type { Database } from '../database/database.types.js';
import {
  enfant,
  foyer,
  outbox,
  parent,
  preferenceNotification,
  type EnfantRow,
  type FoyerRow,
  type ParentRow,
} from '../database/schema.js';
import type {
  AjouterEnfantDto,
  AjouterParentDto,
  CreerFoyerDto,
  EcrireFoyerDto,
  MajPreferencesDto,
  ModifierEnfantDto,
  ModifierParentDto,
} from './foyer.dto.js';
import {
  fusionnerDefauts,
  payloadPreferences,
  typeServiceInjoignable,
  type PreferenceVue,
} from './preferences.util.js';

// Ré-export pour compatibilité des imports existants (`foyer.controller.ts`, tests).
export type { PreferenceVue };

/** Client transactionnel Drizzle (1er paramètre du callback `db.transaction`). */
type DbTransaction = Parameters<Parameters<Database['transaction']>[0]>[0];

/** Projection lisible d'un foyer (tranche dérivée du RFR). */
export interface FoyerVue {
  readonly id: string;
  readonly ressourcesMensuellesCentimes: number;
  readonly ressourcesMensuellesEuros: number;
  readonly rfrCentimes: number;
  readonly rfrEuros: number;
  readonly nbEnfantsACharge: number;
  readonly nbParts: number;
  readonly tranche: 1 | 2 | 3;
}

export interface EnfantVue {
  readonly id: string;
  readonly foyerId: string;
  readonly prenom: string;
  readonly dateNaissance: string;
}

export interface ParentVue {
  readonly id: string;
  readonly foyerId: string;
  readonly prenom: string | null;
  readonly nom: string | null;
  readonly email: string;
  readonly principal: boolean;
  readonly ordre: number;
  readonly actif: boolean;
}

/** Dossier complet renvoyé par la création atomique : foyer + enfants + parents. */
export interface DossierFoyerVue {
  readonly foyer: FoyerVue;
  readonly enfants: readonly EnfantVue[];
  readonly parents: readonly ParentVue[];
}

/**
 * Extrait une violation d'unicité Postgres (`23505`) de l'erreur, en remontant la
 * chaîne des `cause` : drizzle-orm (≥ 0.45) enveloppe toute erreur de requête dans
 * un `DrizzleQueryError` dont la `PostgresError` d'origine (portant `code` et
 * `constraint_name`) est la **cause** — elle n'est plus au premier niveau.
 * Renvoie l'erreur Postgres trouvée, ou `undefined` si ce n'en est pas une.
 */
function violationUnicite(
  erreur: unknown,
): { code: string; constraint_name?: string } | undefined {
  let courant: unknown = erreur;
  for (
    let profondeur = 0;
    profondeur < 4 && typeof courant === 'object' && courant !== null;
    profondeur += 1
  ) {
    if ((courant as { code?: unknown }).code === '23505') {
      return courant as { code: string; constraint_name?: string };
    }
    courant = (courant as { cause?: unknown }).cause;
  }
  return undefined;
}

@Injectable()
export class FoyerService {
  constructor(@Inject(DRIZZLE) private readonly db: Database) {}

  /**
   * Crée un foyer **et son dossier** (enfants + parents) dans **une seule
   * transaction** : soit le dossier complet existe, soit rien (atomicité, doc 06
   * §8.4). Chaque changement d'état émet son événement outbox dans la même
   * transaction (`FoyerMisAJour`, N×`EnfantAjoute`, M×`ParentAjoute`). La règle
   * « le créateur devient parent » (P5) vit **ici** (portée depuis la gateway) :
   * `createurEmail`, fourni pour une identité non-admin, est rattaché en fin de
   * liste s'il n'est pas déjà saisi. Un e-mail dupliqué (unicité) annule **tout**
   * le dossier (409 via `traduireUnicite`).
   */
  async creer(dto: CreerFoyerDto): Promise<DossierFoyerVue> {
    // Validation domaine AVANT toute écriture (foyer + chaque enfant).
    const domaine = this.versDomaine(dto);
    const foyerId = randomUUID();
    const enfantsPrepares = dto.enfants.map((saisie) => ({
      id: enfantIdSchema.parse(randomUUID()),
      prenom: Enfant.creer({
        prenom: saisie.prenom,
        dateNaissance: new Date(saisie.dateNaissance),
      }).prenom,
      dateNaissance: saisie.dateNaissance,
    }));
    // Le créateur non-admin devient parent (dédoublonnage insensible à la casse).
    const parentsFinal = parentsAvecCreateur(dto.parents, dto.createurEmail);
    try {
      return await this.db.transaction(async (tx) => {
        // 1) foyer + FoyerMisAJour.
        await tx.insert(foyer).values({
          id: foyerId,
          ressourcesMensuellesCentimes: domaine.ressourcesMensuelles.centimes,
          rfrCentimes: domaine.rfr.centimes,
          nbEnfantsACharge: domaine.nbEnfantsACharge,
          nbParts: domaine.nbParts,
        });
        await tx.insert(outbox).values(this.evenementFoyer(foyerId, domaine));
        // 2) enfants + EnfantAjoute.
        const enfants: EnfantVue[] = [];
        for (const prepare of enfantsPrepares) {
          const insere = await tx
            .insert(enfant)
            .values({
              id: prepare.id,
              foyerId,
              prenom: prepare.prenom,
              dateNaissance: prepare.dateNaissance,
            })
            .returning();
          const ligne = insere[0];
          if (!ligne) {
            throw new Error(
              `insertion enfant échouée pour le foyer ${foyerId}`,
            );
          }
          const payload: EnfantAjoutePayload = {
            foyerId: foyerIdSchema.parse(foyerId),
            enfantId: prepare.id,
            prenom: prepare.prenom,
            dateNaissance: prepare.dateNaissance,
          };
          await tx.insert(outbox).values({
            id: randomUUID(),
            type: ENFANT_AJOUTE_TYPE,
            payload,
            traceId: traceIdCourant(),
          });
          enfants.push(this.versEnfantVue(ligne));
        }
        // 3) parents + ParentAjoute (état complet).
        const parents: ParentVue[] = [];
        for (const saisie of parentsFinal) {
          const insere = await tx
            .insert(parent)
            .values({
              id: parentIdSchema.parse(randomUUID()),
              foyerId,
              prenom: saisie.prenom ?? null,
              nom: saisie.nom ?? null,
              email: saisie.email.trim(),
              principal: saisie.principal,
              ordre: saisie.ordre,
            })
            .returning();
          const ligne = insere[0];
          if (!ligne) {
            throw new Error(
              `insertion parent échouée pour le foyer ${foyerId}`,
            );
          }
          await tx
            .insert(outbox)
            .values(this.evenementParentEtat(PARENT_AJOUTE_TYPE, ligne));
          parents.push(this.versParentVue(ligne));
        }
        const foyerVue = this.versVue({
          id: foyerId,
          ressourcesMensuellesCentimes: domaine.ressourcesMensuelles.centimes,
          rfrCentimes: domaine.rfr.centimes,
          nbEnfantsACharge: domaine.nbEnfantsACharge,
          nbParts: domaine.nbParts,
        });
        return { foyer: foyerVue, enfants, parents };
      });
    } catch (erreur) {
      this.traduireUnicite(erreur);
    }
  }

  /** Met à jour les finances d'un foyer + ré-émet `FoyerMisAJour`. */
  async mettreAJour(id: string, dto: EcrireFoyerDto): Promise<FoyerVue> {
    const domaine = this.versDomaine(dto);
    const vue = await this.db.transaction(async (tx) => {
      const maj = await tx
        .update(foyer)
        .set({
          ressourcesMensuellesCentimes: domaine.ressourcesMensuelles.centimes,
          rfrCentimes: domaine.rfr.centimes,
          nbEnfantsACharge: domaine.nbEnfantsACharge,
          nbParts: domaine.nbParts,
          updatedAt: new Date(),
        })
        .where(eq(foyer.id, id))
        .returning();
      const ligne = maj[0];
      if (!ligne) {
        throw new NotFoundException(`foyer introuvable : ${id}`);
      }
      await tx.insert(outbox).values(this.evenementFoyer(id, domaine));
      return ligne;
    });
    return this.versVue(vue);
  }

  /** Liste les foyers existants, du plus ancien au plus récent. */
  async lister(): Promise<FoyerVue[]> {
    const lignes = await this.db
      .select()
      .from(foyer)
      .orderBy(asc(foyer.createdAt));
    return lignes.map((l) => this.versVue(l));
  }

  /** Lit un foyer ; la tranche RFR est dérivée à la lecture. */
  async obtenir(id: string): Promise<FoyerVue> {
    const lignes = await this.db.select().from(foyer).where(eq(foyer.id, id));
    const ligne = lignes[0];
    if (!ligne) {
      throw new NotFoundException(`foyer introuvable : ${id}`);
    }
    return this.versVue(ligne);
  }

  /** Rattache un enfant + émet `EnfantAjoute` dans la même transaction. */
  async ajouterEnfant(
    foyerId: string,
    dto: AjouterEnfantDto,
  ): Promise<EnfantVue> {
    // Valide via le domaine (prénom non vide, date interprétable).
    const enfantDomaine = Enfant.creer({
      prenom: dto.prenom,
      dateNaissance: new Date(dto.dateNaissance),
    });
    // Brandé à la frontière : à partir d'ici l'identité est nominale (EnfantId).
    const enfantId = enfantIdSchema.parse(randomUUID());
    const ligne = await this.db.transaction(async (tx) => {
      const foyers = await tx.select().from(foyer).where(eq(foyer.id, foyerId));
      if (!foyers[0]) {
        throw new NotFoundException(`foyer introuvable : ${foyerId}`);
      }
      const insere = await tx
        .insert(enfant)
        .values({
          id: enfantId,
          foyerId,
          prenom: enfantDomaine.prenom,
          dateNaissance: dto.dateNaissance,
        })
        .returning();
      const ligneInseree = insere[0];
      if (!ligneInseree) {
        throw new Error(`insertion enfant échouée pour le foyer ${foyerId}`);
      }
      const payload: EnfantAjoutePayload = {
        foyerId: foyerIdSchema.parse(foyerId),
        enfantId,
        prenom: enfantDomaine.prenom,
        dateNaissance: dto.dateNaissance,
      };
      await tx.insert(outbox).values({
        id: randomUUID(),
        type: ENFANT_AJOUTE_TYPE,
        payload,
        traceId: traceIdCourant(),
      });
      return ligneInseree;
    });
    return this.versEnfantVue(ligne);
  }

  async listerEnfants(foyerId: string): Promise<EnfantVue[]> {
    const lignes = await this.db
      .select()
      .from(enfant)
      .where(eq(enfant.foyerId, foyerId))
      .orderBy(asc(enfant.dateNaissance));
    return lignes.map((l) => this.versEnfantVue(l));
  }

  /** Met à jour un enfant (prénom/date) + émet `EnfantModifie` (même transaction). */
  async modifierEnfant(
    foyerId: string,
    enfantId: string,
    dto: ModifierEnfantDto,
  ): Promise<EnfantVue> {
    // Valide via le domaine (prénom non vide, date interprétable) avant écriture.
    const enfantDomaine = Enfant.creer({
      prenom: dto.prenom,
      dateNaissance: new Date(dto.dateNaissance),
    });
    const ligne = await this.db.transaction(async (tx) => {
      const maj = await tx
        .update(enfant)
        .set({ prenom: enfantDomaine.prenom, dateNaissance: dto.dateNaissance })
        .where(and(eq(enfant.id, enfantId), eq(enfant.foyerId, foyerId)))
        .returning();
      const ligneMaj = maj[0];
      if (!ligneMaj) {
        throw new NotFoundException(`enfant introuvable : ${enfantId}`);
      }
      const payload: EnfantModifiePayload = {
        foyerId: foyerIdSchema.parse(foyerId),
        enfantId: enfantIdSchema.parse(enfantId),
        prenom: enfantDomaine.prenom,
        dateNaissance: dto.dateNaissance,
      };
      await tx.insert(outbox).values({
        id: randomUUID(),
        type: ENFANT_MODIFIE_TYPE,
        payload,
        traceId: traceIdCourant(),
      });
      return ligneMaj;
    });
    return this.versEnfantVue(ligne);
  }

  /**
   * Retire un enfant du foyer (**hard delete** — pas de colonne `actif`, cohérent
   * avec le `ON DELETE CASCADE`) + émet `EnfantRetire` dans la même transaction.
   */
  async retirerEnfant(foyerId: string, enfantId: string): Promise<void> {
    await this.db.transaction(async (tx) => {
      const supprime = await tx
        .delete(enfant)
        .where(and(eq(enfant.id, enfantId), eq(enfant.foyerId, foyerId)))
        .returning();
      if (!supprime[0]) {
        throw new NotFoundException(`enfant introuvable : ${enfantId}`);
      }
      const payload: EnfantRetirePayload = {
        foyerId: foyerIdSchema.parse(foyerId),
        enfantId: enfantIdSchema.parse(enfantId),
      };
      await tx.insert(outbox).values({
        id: randomUUID(),
        type: ENFANT_RETIRE_TYPE,
        payload,
        traceId: traceIdCourant(),
      });
    });
  }

  /**
   * Rattache un parent + émet `ParentAjoute` dans la même transaction.
   *
   * **Réactivation** : si une ligne **inactive** (retirée / soft-delete) du même
   * foyer porte déjà le même `lower(email)`, on la **réactive** (`actif = true`)
   * en reprenant l'identité douce / `principal` / `ordre` de la saisie, au lieu
   * d'insérer une nouvelle ligne — l'unicité e-mail étant désormais **par foyer sur
   * les actifs** (`parent_email_par_foyer_actif_idx`), sans quoi un retrait
   * condamnerait l'e-mail à jamais. L'événement `ParentAjoute` porte l'état complet
   * (les consommateurs upsertent par `id` : la projection `foyer_parent` repasse
   * `actif = true`), dans la même transaction que l'écriture (patron outbox).
   */
  async ajouterParent(
    foyerId: string,
    dto: AjouterParentDto,
  ): Promise<ParentVue> {
    const parentId = parentIdSchema.parse(randomUUID());
    const email = dto.email.trim();
    const emailNormalise = email.toLowerCase();
    try {
      const ligne = await this.db.transaction(async (tx) => {
        const foyers = await tx
          .select()
          .from(foyer)
          .where(eq(foyer.id, foyerId));
        if (!foyers[0]) {
          throw new NotFoundException(`foyer introuvable : ${foyerId}`);
        }
        // Une ligne INACTIVE du même foyer avec ce lower(email) ? → réactivation.
        const inactifs = await tx
          .select()
          .from(parent)
          .where(
            and(
              eq(parent.foyerId, foyerId),
              eq(parent.actif, false),
              sql`lower(${parent.email}) = ${emailNormalise}`,
            ),
          );
        const inactif = inactifs[0];
        const persistee = inactif
          ? await tx
              .update(parent)
              .set({
                actif: true,
                prenom: dto.prenom ?? null,
                nom: dto.nom ?? null,
                email,
                principal: dto.principal,
                ordre: dto.ordre,
                updatedAt: new Date(),
              })
              .where(
                and(eq(parent.id, inactif.id), eq(parent.foyerId, foyerId)),
              )
              .returning()
          : await tx
              .insert(parent)
              .values({
                id: parentId,
                foyerId,
                prenom: dto.prenom ?? null,
                nom: dto.nom ?? null,
                email,
                principal: dto.principal,
                ordre: dto.ordre,
              })
              .returning();
        const ligneParent = persistee[0];
        if (!ligneParent) {
          throw new Error(`écriture parent échouée pour le foyer ${foyerId}`);
        }
        await tx
          .insert(outbox)
          .values(this.evenementParentEtat(PARENT_AJOUTE_TYPE, ligneParent));
        return ligneParent;
      });
      return this.versParentVue(ligne);
    } catch (erreur) {
      this.traduireUnicite(erreur);
    }
  }

  /** Liste les parents **actifs** d'un foyer, dans l'ordre d'affichage stable. */
  async listerParents(foyerId: string): Promise<ParentVue[]> {
    const lignes = await this.db
      .select()
      .from(parent)
      .where(and(eq(parent.foyerId, foyerId), eq(parent.actif, true)))
      .orderBy(asc(parent.ordre), asc(parent.createdAt));
    return lignes.map((l) => this.versParentVue(l));
  }

  /** Met à jour les champs fournis d'un parent + ré-émet `ParentModifie`. */
  async modifierParent(
    foyerId: string,
    parentId: string,
    dto: ModifierParentDto,
  ): Promise<ParentVue> {
    const set: Partial<typeof parent.$inferInsert> = { updatedAt: new Date() };
    if (dto.email !== undefined) set.email = dto.email.trim();
    if (dto.prenom !== undefined) set.prenom = dto.prenom;
    if (dto.nom !== undefined) set.nom = dto.nom;
    if (dto.principal !== undefined) set.principal = dto.principal;
    if (dto.ordre !== undefined) set.ordre = dto.ordre;
    if (dto.actif !== undefined) set.actif = dto.actif;
    try {
      const ligne = await this.db.transaction(async (tx) => {
        // Un passage explicite `actif: false` = retrait : refuser s'il retirerait
        // le dernier parent actif (même garde que `retirerParent`, DANS la transaction).
        if (dto.actif === false) {
          await this.gardeDernierParentActif(tx, foyerId, parentId);
        }
        const maj = await tx
          .update(parent)
          .set(set)
          .where(and(eq(parent.id, parentId), eq(parent.foyerId, foyerId)))
          .returning();
        const ligneMaj = maj[0];
        if (!ligneMaj) {
          throw new NotFoundException(`parent introuvable : ${parentId}`);
        }
        await tx
          .insert(outbox)
          .values(this.evenementParentEtat(PARENT_MODIFIE_TYPE, ligneMaj));
        return ligneMaj;
      });
      return this.versParentVue(ligne);
    } catch (erreur) {
      this.traduireUnicite(erreur);
    }
  }

  /** Retire un parent (soft-delete `actif = false`) + émet `ParentRetire`. */
  async retirerParent(foyerId: string, parentId: string): Promise<void> {
    await this.db.transaction(async (tx) => {
      // Refuser le retrait du dernier parent actif (DANS la transaction, verrou).
      await this.gardeDernierParentActif(tx, foyerId, parentId);
      const maj = await tx
        .update(parent)
        .set({ actif: false, updatedAt: new Date() })
        .where(and(eq(parent.id, parentId), eq(parent.foyerId, foyerId)))
        .returning();
      const ligneMaj = maj[0];
      if (!ligneMaj) {
        throw new NotFoundException(`parent introuvable : ${parentId}`);
      }
      const payload: ParentRetirePayload = {
        foyerId: foyerIdSchema.parse(foyerId),
        parentId: parentIdSchema.parse(parentId),
      };
      await tx.insert(outbox).values({
        id: randomUUID(),
        type: PARENT_RETIRE_TYPE,
        payload,
        traceId: traceIdCourant(),
      });
    });
  }

  /**
   * Résolution **identité → foyers** : foyers dont l'e-mail est parent **actif**
   * (comparaison insensible à la casse). Renvoie une liste (un e-mail peut être
   * parent de plusieurs foyers — familles recomposées, multi-clients).
   */
  async foyersParEmail(email: string): Promise<FoyerId[]> {
    const cible = email.trim().toLowerCase();
    if (!cible) {
      return [];
    }
    const lignes = await this.db
      .selectDistinct({ foyerId: parent.foyerId })
      .from(parent)
      .where(
        and(sql`lower(${parent.email}) = ${cible}`, eq(parent.actif, true)),
      );
    return lignes.map((l) => foyerIdSchema.parse(l.foyerId));
  }

  /**
   * Lit les **préférences effectives** d'un parent : le défaut applicatif (§5.1)
   * surchargé par les choix explicites en base. Vérifie que le parent appartient
   * bien au foyer (404 sinon) — défense en profondeur en plus du `@FoyerScope` BFF.
   */
  async lirePreferences(
    foyerId: string,
    parentId: string,
  ): Promise<PreferenceVue[]> {
    await this.parentDuFoyer(this.db, foyerId, parentId);
    const rows = await this.db
      .select()
      .from(preferenceNotification)
      .where(eq(preferenceNotification.parentId, parentId));
    return fusionnerDefauts(rows);
  }

  /**
   * Met à jour les préférences d'un parent : **upsert** des choix explicites +
   * émission de `PreferencesNotifModifiees` (état complet) dans la **même
   * transaction** (patron outbox). Applique l'**invariant service** : pour un type
   * transactionnel, refuser (400) une combinaison « tous canaux off ». Le contrôle
   * porte sur l'état **résultant** (défaut + stocké + upsert), pas sur le seul DTO.
   */
  async majPreferences(
    foyerId: string,
    parentId: string,
    dto: MajPreferencesDto,
  ): Promise<PreferenceVue[]> {
    return this.db.transaction(async (tx) => {
      await this.parentDuFoyer(tx, foyerId, parentId);
      const maintenant = new Date();
      for (const pref of dto.preferences) {
        // Traçabilité RGPD : opt-in ⇒ (re)pose `consentement_at`, purge `desabonne_at` ;
        // opt-out ⇒ pose `desabonne_at` (on conserve le consentement historique).
        const consentementAt = pref.actif ? maintenant : undefined;
        const desabonneAt = pref.actif ? null : maintenant;
        await tx
          .insert(preferenceNotification)
          .values({
            id: randomUUID(),
            parentId,
            typeNotification: pref.typeNotification,
            canal: pref.canal,
            actif: pref.actif,
            consentementAt: consentementAt ?? null,
            desabonneAt,
            sourceDernier: 'ECRAN',
            updatedAt: maintenant,
          })
          .onConflictDoUpdate({
            target: [
              preferenceNotification.parentId,
              preferenceNotification.typeNotification,
              preferenceNotification.canal,
            ],
            set: {
              actif: pref.actif,
              // Ne réécrit `consentement_at` que lors d'un opt-in (sinon on
              // garderait la trace du dernier consentement).
              ...(consentementAt ? { consentementAt } : {}),
              desabonneAt,
              sourceDernier: 'ECRAN',
              updatedAt: maintenant,
            },
          });
      }
      // État résultant relu DANS la transaction : source de vérité de l'invariant
      // ET de l'événement (état complet).
      const rows = await tx
        .select()
        .from(preferenceNotification)
        .where(eq(preferenceNotification.parentId, parentId));
      const effectives = fusionnerDefauts(rows);
      const typeFautif = typeServiceInjoignable(effectives);
      if (typeFautif) {
        throw new BadRequestException(
          `au moins un canal doit rester actif pour ${typeFautif}`,
        );
      }
      await tx.insert(outbox).values({
        id: randomUUID(),
        type: PREFERENCES_NOTIF_MODIFIEES_TYPE,
        payload: payloadPreferences(foyerId, parentId, effectives),
        traceId: traceIdCourant(),
      });
      return effectives;
    });
  }

  private versDomaine(dto: EcrireFoyerDto): Foyer {
    return Foyer.creer({
      ressourcesMensuelles: Money.depuisEuros(dto.ressourcesMensuelles),
      rfr: Money.depuisEuros(dto.rfr),
      nbEnfantsACharge: dto.nbEnfantsACharge,
      nbParts: dto.nbParts,
    });
  }

  /** Construit la ligne d'outbox de `FoyerMisAJour` à partir du domaine. */
  private evenementFoyer(
    id: string,
    domaine: Foyer,
  ): typeof outbox.$inferInsert {
    const payload: FoyerMisAJourPayload = {
      foyerId: foyerIdSchema.parse(id),
      ressourcesMensuellesCentimes: domaine.ressourcesMensuelles.centimes,
      rfrCentimes: domaine.rfr.centimes,
      nbEnfantsACharge: domaine.nbEnfantsACharge,
      nbParts: domaine.nbParts,
      tranche: domaine.tranche.niveau,
    };
    return {
      id: randomUUID(),
      type: FOYER_MIS_A_JOUR_TYPE,
      payload,
      traceId: traceIdCourant(),
    };
  }

  private versVue(
    ligne: Pick<
      FoyerRow,
      | 'id'
      | 'ressourcesMensuellesCentimes'
      | 'rfrCentimes'
      | 'nbEnfantsACharge'
      | 'nbParts'
    >,
  ): FoyerVue {
    const tranche = Tranche.depuisRfr(Money.depuisCentimes(ligne.rfrCentimes));
    return {
      id: ligne.id,
      ressourcesMensuellesCentimes: ligne.ressourcesMensuellesCentimes,
      ressourcesMensuellesEuros: ligne.ressourcesMensuellesCentimes / 100,
      rfrCentimes: ligne.rfrCentimes,
      rfrEuros: ligne.rfrCentimes / 100,
      nbEnfantsACharge: ligne.nbEnfantsACharge,
      nbParts: ligne.nbParts,
      tranche: tranche.niveau,
    };
  }

  private versEnfantVue(ligne: EnfantRow): EnfantVue {
    return {
      id: ligne.id,
      foyerId: ligne.foyerId,
      prenom: ligne.prenom,
      dateNaissance: ligne.dateNaissance,
    };
  }

  /**
   * Ligne d'outbox `ParentAjoute`/`ParentModifie` à partir de l'état projeté du
   * parent (état complet : le consommateur projette sans relire la source).
   */
  private evenementParentEtat(
    type: string,
    ligne: ParentRow,
  ): typeof outbox.$inferInsert {
    // `ParentAjoute` et `ParentModifie` partagent le même payload d'état complet.
    const payload: ParentAjoutePayload = {
      foyerId: foyerIdSchema.parse(ligne.foyerId),
      parentId: parentIdSchema.parse(ligne.id),
      email: ligne.email,
      prenom: ligne.prenom ?? undefined,
      nom: ligne.nom ?? undefined,
      principal: ligne.principal,
      actif: ligne.actif,
    };
    return {
      id: randomUUID(),
      type,
      payload,
      traceId: traceIdCourant(),
    };
  }

  /**
   * Traduit une violation d'unicité en **409 structuré** (`{ statusCode, code,
   * message }`) ; re-jette sinon (dont les 409 déjà structurés — la garde dernier
   * parent — qui ne sont pas des violations Postgres et retraversent tel quel).
   * La violation est cherchée dans l'erreur **et sa chaîne de `cause`**
   * (drizzle-orm l'enveloppe dans un `DrizzleQueryError`, cf. `violationUnicite`).
   * Le `code` machine permet au front de distinguer chaque cause (le BFF relaie le
   * corps amont via `ErreurAmont`).
   */
  private traduireUnicite(erreur: unknown): never {
    const violation = violationUnicite(erreur);
    if (violation) {
      if (violation.constraint_name === 'parent_principal_unique_idx') {
        throw new ConflictException({
          statusCode: 409,
          code: 'PARENT_PRINCIPAL_EXISTANT',
          message: 'un parent principal existe déjà pour ce foyer',
        });
      }
      // Index e-mail `parent_email_par_foyer_actif_idx` : un parent **actif** avec
      // ce `lower(email)` existe déjà **dans ce foyer** (l'unicité est par foyer,
      // plus globale — un même e-mail peut être parent d'un autre foyer). Toute
      // autre unicité 23505 sur `parent` retombe défensivement sur le même code
      // (il n'en existe pas d'autre à ce jour).
      throw new ConflictException({
        statusCode: 409,
        code: 'EMAIL_DEJA_UTILISE',
        message: 'adresse e-mail déjà utilisée dans ce foyer',
      });
    }
    throw erreur;
  }

  /**
   * Garde **« au moins un parent actif par foyer »** (transition 1→0 interdite).
   * Dans la transaction courante, verrouille les lignes parents **actives** du
   * foyer (`SELECT ... FOR UPDATE`) : si le parent visé en est le **dernier**
   * actif, lève un 409 `DERNIER_PARENT_ACTIF` (aucun événement émis). Le verrou
   * sérialise deux retraits concurrents — la garde vit dans la transaction, pas en
   * pré-lecture. Ne s'applique qu'à la transition 1→0 : un foyer déjà sans parent
   * actif (créé sans parent par un admin) reste possible.
   */
  private async gardeDernierParentActif(
    tx: DbTransaction,
    foyerId: string,
    parentId: string,
  ): Promise<void> {
    const actifs = await tx
      .select({ id: parent.id })
      .from(parent)
      .where(and(eq(parent.foyerId, foyerId), eq(parent.actif, true)))
      .for('update');
    if (actifs.length === 1 && actifs[0]?.id === parentId) {
      throw new ConflictException({
        statusCode: 409,
        code: 'DERNIER_PARENT_ACTIF',
        message: 'impossible de retirer le dernier parent actif du foyer',
      });
    }
  }

  private versParentVue(ligne: ParentRow): ParentVue {
    return {
      id: ligne.id,
      foyerId: ligne.foyerId,
      prenom: ligne.prenom,
      nom: ligne.nom,
      email: ligne.email,
      principal: ligne.principal,
      ordre: ligne.ordre,
      actif: ligne.actif,
    };
  }

  /**
   * Charge le parent `parentId` **du foyer** `foyerId` (scoping par les deux clés,
   * comme `modifierParent`) ou lève un 404. Accepte le client transactionnel ou la
   * connexion racine.
   */
  private async parentDuFoyer(
    db: Database | DbTransaction,
    foyerId: string,
    parentId: string,
  ): Promise<ParentRow> {
    const lignes = await db
      .select()
      .from(parent)
      .where(and(eq(parent.id, parentId), eq(parent.foyerId, foyerId)));
    const ligne = lignes[0];
    if (!ligne) {
      throw new NotFoundException(`parent introuvable : ${parentId}`);
    }
    return ligne;
  }
}

/**
 * Garantit que l'**e-mail du créateur** figure parmi les parents (P5) : sans lui,
 * un parent qui s'auto-crée un foyer ne pourrait pas l'éditer ensuite
 * (`AppartenanceGuard` autorise via `foyersParEmail`). Idempotent : on ne duplique
 * pas un e-mail déjà saisi (comparaison insensible à la casse). Le créateur est
 * ajouté **en fin** de liste avec l'`ordre` suivant. La gateway ne fournit
 * `createurEmail` que pour une identité **non-admin** (l'admin provisionne pour
 * autrui, sans se rattacher ; une identité absente reste en mode hérité).
 */
function parentsAvecCreateur(
  parents: readonly AjouterParentDto[],
  createurEmail: string | undefined,
): AjouterParentDto[] {
  if (createurEmail === undefined) {
    return [...parents];
  }
  const cible = createurEmail.trim().toLowerCase();
  const dejaPresent = parents.some(
    (p) => p.email.trim().toLowerCase() === cible,
  );
  if (dejaPresent) {
    return [...parents];
  }
  const ordreSuivant =
    parents.reduce((max, p) => Math.max(max, p.ordre), -1) + 1;
  return [
    ...parents,
    { email: createurEmail, principal: false, ordre: ordreSuivant },
  ];
}
