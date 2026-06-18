import { randomUUID } from 'node:crypto';
import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import { asc, eq } from 'drizzle-orm';
import { Money, Tranche } from '@creche-planner/shared-kernel';
import { Enfant, Foyer } from '@creche-planner/foyer-domain';
import {
  ENFANT_AJOUTE_TYPE,
  FOYER_MIS_A_JOUR_TYPE,
  enfantIdSchema,
  foyerIdSchema,
  type EnfantAjoutePayload,
  type FoyerMisAJourPayload,
} from '@creche-planner/contracts-foyer';
import { DRIZZLE, traceIdCourant } from '@creche-planner/nest-commons';
import type { Database } from '../database/database.types.js';
import {
  enfant,
  foyer,
  outbox,
  type EnfantRow,
  type FoyerRow,
} from '../database/schema.js';
import type { AjouterEnfantDto, EcrireFoyerDto } from './foyer.dto.js';

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
}
