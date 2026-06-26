import { randomUUID } from 'node:crypto';
import {
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
  FOYER_MIS_A_JOUR_TYPE,
  PARENT_AJOUTE_TYPE,
  PARENT_MODIFIE_TYPE,
  PARENT_RETIRE_TYPE,
  enfantIdSchema,
  foyerIdSchema,
  parentIdSchema,
  type EnfantAjoutePayload,
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
  type EnfantRow,
  type FoyerRow,
  type ParentRow,
} from '../database/schema.js';
import type {
  AjouterEnfantDto,
  AjouterParentDto,
  EcrireFoyerDto,
  ModifierParentDto,
} from './foyer.dto.js';

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

/** Détection d'une violation d'unicité Postgres (`23505`) portée par `postgres`. */
function estViolationUnicite(
  erreur: unknown,
): erreur is { code: string; constraint_name?: string } {
  return (
    typeof erreur === 'object' &&
    erreur !== null &&
    (erreur as { code?: unknown }).code === '23505'
  );
}

@Injectable()
export class FoyerService {
  constructor(@Inject(DRIZZLE) private readonly db: Database) {}

  /** Crée un foyer + émet `FoyerMisAJour` dans la même transaction (outbox). */
  async creer(dto: EcrireFoyerDto): Promise<FoyerVue> {
    const domaine = this.versDomaine(dto);
    const id = randomUUID();
    await this.db.transaction(async (tx) => {
      await tx.insert(foyer).values({
        id,
        ressourcesMensuellesCentimes: domaine.ressourcesMensuelles.centimes,
        rfrCentimes: domaine.rfr.centimes,
        nbEnfantsACharge: domaine.nbEnfantsACharge,
        nbParts: domaine.nbParts,
      });
      await tx.insert(outbox).values(this.evenementFoyer(id, domaine));
    });
    return this.versVue({
      id,
      ressourcesMensuellesCentimes: domaine.ressourcesMensuelles.centimes,
      rfrCentimes: domaine.rfr.centimes,
      nbEnfantsACharge: domaine.nbEnfantsACharge,
      nbParts: domaine.nbParts,
    });
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

  /** Rattache un parent + émet `ParentAjoute` dans la même transaction. */
  async ajouterParent(
    foyerId: string,
    dto: AjouterParentDto,
  ): Promise<ParentVue> {
    const parentId = parentIdSchema.parse(randomUUID());
    const email = dto.email.trim();
    try {
      const ligne = await this.db.transaction(async (tx) => {
        const foyers = await tx
          .select()
          .from(foyer)
          .where(eq(foyer.id, foyerId));
        if (!foyers[0]) {
          throw new NotFoundException(`foyer introuvable : ${foyerId}`);
        }
        const insere = await tx
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
        const ligneInseree = insere[0];
        if (!ligneInseree) {
          throw new Error(`insertion parent échouée pour le foyer ${foyerId}`);
        }
        await tx
          .insert(outbox)
          .values(this.evenementParentEtat(PARENT_AJOUTE_TYPE, ligneInseree));
        return ligneInseree;
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

  /** Traduit une violation d'unicité en 409 explicite ; re-jette sinon. */
  private traduireUnicite(erreur: unknown): never {
    if (estViolationUnicite(erreur)) {
      const message =
        erreur.constraint_name === 'parent_principal_unique_idx'
          ? 'un parent principal existe déjà pour ce foyer'
          : 'adresse e-mail déjà utilisée';
      throw new ConflictException(message);
    }
    throw erreur;
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
}
