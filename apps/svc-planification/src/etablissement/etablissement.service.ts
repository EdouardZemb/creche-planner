import { randomUUID } from 'node:crypto';
import {
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { asc, eq } from 'drizzle-orm';
import {
  ETABLISSEMENT_CREE_TYPE,
  ETABLISSEMENT_MODIFIE_TYPE,
  ETABLISSEMENT_SUPPRIME_TYPE,
  type EtablissementCreePayload,
  type EtablissementSupprimePayload,
  type ModeContrat,
  type PreavisRegle,
} from '@creche-planner/contracts-planification';
import { DRIZZLE, traceIdCourant } from '@creche-planner/nest-commons';
import type { Database } from '../database/database.types.js';
import {
  etablissement,
  outbox,
  type EtablissementRow,
} from '../database/schema.js';
import type {
  CreerEtablissementDto,
  ModifierEtablissementDto,
} from './etablissement.dto.js';

/** Projection lisible d'un établissement. */
export interface EtablissementVue {
  readonly id: string;
  readonly foyerId: string;
  readonly nom: string;
  readonly emailService: string | null;
  readonly preavisRegle: PreavisRegle | null;
  readonly types: readonly ModeContrat[];
  readonly adresse: string | null;
  readonly telephone: string | null;
  readonly contact: string | null;
  readonly actif: boolean;
}

/** Détection d'une violation d'unicité Postgres (`23505`) portée par `postgres`. */
function estViolationUnicite(erreur: unknown): erreur is { code: string } {
  return (
    typeof erreur === 'object' &&
    erreur !== null &&
    (erreur as { code?: unknown }).code === '23505'
  );
}

@Injectable()
export class EtablissementService {
  constructor(@Inject(DRIZZLE) private readonly db: Database) {}

  /** Liste les établissements d'un foyer, triés par nom (rendu stable). */
  async lister(foyerId: string): Promise<EtablissementVue[]> {
    const lignes = await this.db
      .select()
      .from(etablissement)
      .where(eq(etablissement.foyerId, foyerId))
      .orderBy(asc(etablissement.nom));
    return lignes.map((l) => this.versVue(l));
  }

  /** Lit un établissement par son id. 404 s'il n'existe pas. */
  async parId(id: string): Promise<EtablissementVue> {
    const lignes = await this.db
      .select()
      .from(etablissement)
      .where(eq(etablissement.id, id));
    const ligne = lignes[0];
    if (!ligne) {
      throw new NotFoundException(`établissement introuvable : ${id}`);
    }
    return this.versVue(ligne);
  }

  /**
   * Crée un établissement pour un foyer + émet `EtablissementCree` dans la même
   * transaction (outbox). 409 si le nom est déjà pris dans ce foyer.
   */
  async creer(
    foyerId: string,
    dto: CreerEtablissementDto,
  ): Promise<EtablissementVue> {
    try {
      const ligne = await this.db.transaction(async (tx) => {
        const insere = await tx
          .insert(etablissement)
          .values({
            id: randomUUID(),
            foyerId,
            nom: dto.nom,
            emailService: dto.emailService ?? null,
            preavisRegle: dto.preavisRegle ?? null,
            types: dto.types ?? [],
            adresse: dto.adresse ?? null,
            telephone: dto.telephone ?? null,
            contact: dto.contact ?? null,
            actif: dto.actif ?? true,
          })
          .returning();
        const ligneInseree = insere[0];
        if (!ligneInseree) {
          throw new Error(`insertion établissement échouée (foyer ${foyerId})`);
        }
        await tx
          .insert(outbox)
          .values(this.evenementEtat(ETABLISSEMENT_CREE_TYPE, ligneInseree));
        return ligneInseree;
      });
      return this.versVue(ligne);
    } catch (erreur) {
      this.traduireUnicite(erreur);
    }
  }

  /**
   * Met à jour les champs **fournis** d'un établissement + ré-émet
   * `EtablissementModifie` dans la même transaction. 404 si l'établissement
   * n'existe pas, 409 si le nouveau nom collisionne dans le foyer.
   */
  async modifier(
    id: string,
    dto: ModifierEtablissementDto,
  ): Promise<EtablissementVue> {
    const set: Partial<typeof etablissement.$inferInsert> = {
      updatedAt: new Date(),
    };
    if (dto.nom !== undefined) set.nom = dto.nom;
    if (dto.emailService !== undefined)
      set.emailService = dto.emailService ?? null;
    if (dto.preavisRegle !== undefined)
      set.preavisRegle = dto.preavisRegle ?? null;
    if (dto.types !== undefined) set.types = dto.types;
    if (dto.adresse !== undefined) set.adresse = dto.adresse ?? null;
    if (dto.telephone !== undefined) set.telephone = dto.telephone ?? null;
    if (dto.contact !== undefined) set.contact = dto.contact ?? null;
    if (dto.actif !== undefined) set.actif = dto.actif;
    try {
      const ligne = await this.db.transaction(async (tx) => {
        const maj = await tx
          .update(etablissement)
          .set(set)
          .where(eq(etablissement.id, id))
          .returning();
        const ligneMaj = maj[0];
        if (!ligneMaj) {
          throw new NotFoundException(`établissement introuvable : ${id}`);
        }
        await tx
          .insert(outbox)
          .values(this.evenementEtat(ETABLISSEMENT_MODIFIE_TYPE, ligneMaj));
        return ligneMaj;
      });
      return this.versVue(ligne);
    } catch (erreur) {
      this.traduireUnicite(erreur);
    }
  }

  /**
   * **Archive** un établissement (soft : `actif = false`) + émet
   * `EtablissementModifie` (l'archivage est un changement d'état projeté tel quel).
   * 404 si l'établissement n'existe pas.
   */
  async archiver(id: string): Promise<EtablissementVue> {
    const ligne = await this.db.transaction(async (tx) => {
      const maj = await tx
        .update(etablissement)
        .set({ actif: false, updatedAt: new Date() })
        .where(eq(etablissement.id, id))
        .returning();
      const ligneMaj = maj[0];
      if (!ligneMaj) {
        throw new NotFoundException(`établissement introuvable : ${id}`);
      }
      await tx
        .insert(outbox)
        .values(this.evenementEtat(ETABLISSEMENT_MODIFIE_TYPE, ligneMaj));
      return ligneMaj;
    });
    return this.versVue(ligne);
  }

  /**
   * Supprime un établissement + émet `EtablissementSupprime` dans la même
   * transaction. 404 s'il n'existe pas. **Garde** « suppression bloquée si des
   * contrats y sont rattachés » : appliquée via `compterContratsRattaches`, qui
   * renvoie 0 tant que la colonne `contrat.etablissement_id` n'existe pas (P2). Le
   * point d'extension est donc déjà câblé (409 dès que le comptage sera réel).
   */
  async supprimer(id: string): Promise<void> {
    await this.db.transaction(async (tx) => {
      const lignes = await tx
        .select()
        .from(etablissement)
        .where(eq(etablissement.id, id));
      if (!lignes[0]) {
        throw new NotFoundException(`établissement introuvable : ${id}`);
      }
      const rattaches = await this.compterContratsRattaches();
      if (rattaches > 0) {
        throw new ConflictException(
          `établissement référencé par ${String(rattaches)} contrat(s) : réaffectez-les avant suppression`,
        );
      }
      await tx.delete(etablissement).where(eq(etablissement.id, id));
      const payload: EtablissementSupprimePayload = { etablissementId: id };
      await tx.insert(outbox).values({
        id: randomUUID(),
        type: ETABLISSEMENT_SUPPRIME_TYPE,
        payload,
        traceId: traceIdCourant(),
      });
    });
  }

  /**
   * Point d'extension de la garde de suppression. **P2** ajoutera la colonne
   * `contrat.etablissement_id` puis comptera ici, dans la transaction de
   * `supprimer`, les contrats rattachés à l'établissement (le paramètre `id`
   * réapparaîtra alors). Tant que la colonne n'existe pas, le comptage vaut 0 →
   * aucune suppression n'est bloquée.
   */
  private compterContratsRattaches(): Promise<number> {
    return Promise.resolve(0);
  }

  /**
   * Ligne d'outbox `EtablissementCree`/`EtablissementModifie` à partir de l'état
   * projeté (payload d'état complet : le consommateur projette sans relire la
   * source). Les coordonnées internes (adresse/téléphone/contact) ne voyagent pas.
   */
  private evenementEtat(
    type: string,
    ligne: EtablissementRow,
  ): typeof outbox.$inferInsert {
    const payload: EtablissementCreePayload = {
      etablissementId: ligne.id,
      foyerId: ligne.foyerId,
      nom: ligne.nom,
      emailService: ligne.emailService,
      preavisRegle: ligne.preavisRegle,
      types: ligne.types,
      actif: ligne.actif,
    };
    return {
      id: randomUUID(),
      type,
      payload,
      traceId: traceIdCourant(),
    };
  }

  /** Traduit une violation d'unicité (nom déjà pris dans le foyer) en 409. */
  private traduireUnicite(erreur: unknown): never {
    if (estViolationUnicite(erreur)) {
      throw new ConflictException(
        'un établissement portant ce nom existe déjà pour ce foyer',
      );
    }
    throw erreur;
  }

  private versVue(ligne: EtablissementRow): EtablissementVue {
    return {
      id: ligne.id,
      foyerId: ligne.foyerId,
      nom: ligne.nom,
      emailService: ligne.emailService,
      preavisRegle: ligne.preavisRegle,
      types: ligne.types,
      adresse: ligne.adresse,
      telephone: ligne.telephone,
      contact: ligne.contact,
      actif: ligne.actif,
    };
  }
}
