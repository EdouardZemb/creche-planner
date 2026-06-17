import { randomUUID } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import { asc, eq } from 'drizzle-orm';
import { Money } from '@creche-planner/shared-kernel';
import {
  estModeAbcm,
  parseModeGarde,
  PeriodeValidite,
  selectionnerVersionApplicable,
  trancheDepuisNiveau,
  verifierAbsenceChevauchement,
  type ModeGarde,
} from '@creche-planner/referentiel-domain';
import {
  GRILLE_PUBLIEE_TYPE,
  MODES_ABCM_CONTRAT,
  type GrillePublieePayload,
} from '@creche-planner/contracts-referentiel';
import { DRIZZLE, traceIdCourant } from '@creche-planner/nest-commons';
import type { Database } from '../database/database.types.js';
import {
  baremePsu,
  fraisFixesAbcm,
  grilleAbcm,
  jourNonFacturable,
  outbox,
  type GrilleAbcmRow,
} from '../database/schema.js';
import type { PublierGrilleAbcmDto } from './referentiel.dto.js';

/** Vue d'une grille ABCM publiée (montants en centimes, fidèle à `Money`). */
export interface GrilleAbcmVue {
  readonly id: string;
  readonly tranche: 1 | 2 | 3;
  readonly valideDu: string;
  readonly valideAu: string | null;
  readonly cantineTotalCentimes: number;
  readonly cantinePartGardeCentimes: number | null;
  readonly periMatinCentimes: number;
  readonly periSoirCentimes: number;
  readonly alshJourneeCompleteCentimes: number;
  readonly alshDemiJourneeCentimes: number;
  readonly alshRepasCentimes: number;
}

/** Réponse « grille applicable à (date, tranche, mode) » — discriminée par `mode`. */
export type GrilleApplicable =
  | {
      readonly mode: 'CANTINE';
      readonly tranche: 1 | 2 | 3;
      readonly valideDu: string;
      readonly valideAu: string | null;
      readonly totalCentimes: number;
      readonly partGardeCentimes: number | null;
    }
  | {
      readonly mode: 'PERISCOLAIRE';
      readonly tranche: 1 | 2 | 3;
      readonly valideDu: string;
      readonly valideAu: string | null;
      readonly matinCentimes: number;
      readonly soirCentimes: number;
    }
  | {
      readonly mode: 'ALSH';
      readonly tranche: 1 | 2 | 3;
      readonly valideDu: string;
      readonly valideAu: string | null;
      readonly journeeCompleteCentimes: number;
      readonly demiJourneeCentimes: number;
      readonly repasCentimes: number;
    }
  | {
      readonly mode: 'CRECHE_PSU';
      readonly valideDu: string;
      readonly valideAu: string | null;
      readonly taux: unknown;
      readonly plancherCentimes: number | null;
      readonly plafondCentimes: number | null;
    };

export interface FraisFixesVue {
  readonly valideDu: string;
  readonly valideAu: string | null;
  readonly cotisation1EnfantCentimes: number;
  readonly premiereInscriptionCentimes: number;
}

export interface JourNonFacturableVue {
  readonly jour: string;
  readonly type: string;
  readonly libelle: string;
}

@Injectable()
export class ReferentielService {
  constructor(@Inject(DRIZZLE) private readonly db: Database) {}

  /**
   * Publie une grille ABCM versionnée : valide période/tranche via le domaine,
   * refuse un chevauchement avec une grille existante de la même tranche, puis
   * insère la grille et émet un `GrillePubliee` **par mode ABCM** dans la même
   * transaction (outbox).
   */
  async publierGrilleAbcm(dto: PublierGrilleAbcmDto): Promise<GrilleAbcmVue> {
    const tranche = trancheDepuisNiveau(dto.tranche);
    const periode = PeriodeValidite.creer(
      dto.valideDu,
      dto.valideAu ?? undefined,
    );

    const existantes = await this.db
      .select()
      .from(grilleAbcm)
      .where(eq(grilleAbcm.tranche, tranche.niveau));
    verifierAbsenceChevauchement([
      ...existantes.map((g) =>
        PeriodeValidite.creer(g.valideDu, g.valideAu ?? undefined),
      ),
      periode,
    ]);

    const id = randomUUID();
    const vue: GrilleAbcmVue = {
      id,
      tranche: tranche.niveau,
      valideDu: dto.valideDu,
      valideAu: dto.valideAu ?? null,
      cantineTotalCentimes: Money.depuisEuros(dto.cantineTotal).centimes,
      cantinePartGardeCentimes:
        dto.cantinePartGarde === undefined
          ? null
          : Money.depuisEuros(dto.cantinePartGarde).centimes,
      periMatinCentimes: Money.depuisEuros(dto.periMatin).centimes,
      periSoirCentimes: Money.depuisEuros(dto.periSoir).centimes,
      alshJourneeCompleteCentimes: Money.depuisEuros(dto.alshJourneeComplete)
        .centimes,
      alshDemiJourneeCentimes: Money.depuisEuros(dto.alshDemiJournee).centimes,
      alshRepasCentimes: Money.depuisEuros(dto.alshRepas).centimes,
    };

    await this.db.transaction(async (tx) => {
      await tx.insert(grilleAbcm).values(vue);
      for (const mode of MODES_ABCM_CONTRAT) {
        const payload: GrillePublieePayload = {
          grilleId: id,
          mode,
          tranche: tranche.niveau,
          valideDu: dto.valideDu,
          valideAu: dto.valideAu ?? null,
        };
        await tx.insert(outbox).values({
          id: randomUUID(),
          type: GRILLE_PUBLIEE_TYPE,
          payload,
          traceId: traceIdCourant(),
        });
      }
    });

    return vue;
  }

  /** Grille/barème applicable à `(date, tranche, mode)` (DoD Phase 4). */
  async grilleApplicable(
    date: string,
    mode: string,
    tranche: number | undefined,
  ): Promise<GrilleApplicable> {
    const modeGarde = parseModeGarde(mode);
    if (estModeAbcm(modeGarde)) {
      return this.grilleAbcmApplicable(date, modeGarde, tranche);
    }
    return this.baremePsuApplicable(date);
  }

  private async grilleAbcmApplicable(
    date: string,
    mode: ModeGarde,
    tranche: number | undefined,
  ): Promise<GrilleApplicable> {
    const niveau = trancheDepuisNiveau(tranche ?? Number.NaN).niveau;
    const rows = await this.db
      .select()
      .from(grilleAbcm)
      .where(eq(grilleAbcm.tranche, niveau));
    const sel = selectionnerVersionApplicable(
      rows.map((row) => ({
        periode: PeriodeValidite.creer(row.valideDu, row.valideAu ?? undefined),
        row,
      })),
      date,
    );
    return this.projeterMode(sel.row, mode, niveau);
  }

  private projeterMode(
    row: GrilleAbcmRow,
    mode: ModeGarde,
    tranche: number,
  ): GrilleApplicable {
    const base = {
      tranche: tranche as 1 | 2 | 3,
      valideDu: row.valideDu,
      valideAu: row.valideAu,
    };
    if (mode === 'CANTINE') {
      return {
        mode: 'CANTINE',
        ...base,
        totalCentimes: row.cantineTotalCentimes,
        partGardeCentimes: row.cantinePartGardeCentimes,
      };
    }
    if (mode === 'PERISCOLAIRE') {
      return {
        mode: 'PERISCOLAIRE',
        ...base,
        matinCentimes: row.periMatinCentimes,
        soirCentimes: row.periSoirCentimes,
      };
    }
    return {
      mode: 'ALSH',
      ...base,
      journeeCompleteCentimes: row.alshJourneeCompleteCentimes,
      demiJourneeCentimes: row.alshDemiJourneeCentimes,
      repasCentimes: row.alshRepasCentimes,
    };
  }

  private async baremePsuApplicable(date: string): Promise<GrilleApplicable> {
    const rows = await this.db.select().from(baremePsu);
    const sel = selectionnerVersionApplicable(
      rows.map((row) => ({
        periode: PeriodeValidite.creer(row.valideDu, row.valideAu ?? undefined),
        row,
      })),
      date,
    );
    return {
      mode: 'CRECHE_PSU',
      valideDu: sel.row.valideDu,
      valideAu: sel.row.valideAu,
      taux: sel.row.taux,
      plancherCentimes: sel.row.plancherCentimes,
      plafondCentimes: sel.row.plafondCentimes,
    };
  }

  /** Frais fixes ABCM applicables à `date` (doc 02 §4.4). */
  async fraisFixesApplicable(date: string): Promise<FraisFixesVue> {
    const rows = await this.db.select().from(fraisFixesAbcm);
    const sel = selectionnerVersionApplicable(
      rows.map((row) => ({
        periode: PeriodeValidite.creer(row.valideDu, row.valideAu ?? undefined),
        row,
      })),
      date,
    );
    return {
      valideDu: sel.row.valideDu,
      valideAu: sel.row.valideAu,
      cotisation1EnfantCentimes: sel.row.cotisation1EnfantCentimes,
      premiereInscriptionCentimes: sel.row.premiereInscriptionCentimes,
    };
  }

  /** Jours non facturables (fériés/fermetures/vacances, doc 02 §7, INV-04). */
  async listerJoursNonFacturables(): Promise<JourNonFacturableVue[]> {
    const rows = await this.db
      .select()
      .from(jourNonFacturable)
      .orderBy(asc(jourNonFacturable.jour));
    return rows.map((r) => ({
      jour: r.jour,
      type: r.type,
      libelle: r.libelle,
    }));
  }
}
