import { randomUUID } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import { asc, desc, eq, lt } from 'drizzle-orm';
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
  BAREME_PSU_PUBLIE_TYPE,
  BAREME_TRANCHES_PUBLIE_TYPE,
  GRILLE_PUBLIEE_V2_TYPE,
  MODES_ABCM_CONTRAT,
  type BaremePsuPubliePayload,
  type BaremeTranchesPubliePayload,
  type GrillePublieeV2Payload,
  type ParametresGrille,
  type SeuilTranchePayload,
} from '@creche-planner/contracts-referentiel';
import { DRIZZLE, traceIdCourant } from '@creche-planner/nest-commons';
import type { Database } from '../database/database.types.js';
import {
  baremePsu,
  baremeTranches,
  grilleAbcm,
  jourNonFacturable,
  outbox,
  type GrilleAbcmRow,
} from '../database/schema.js';
import {
  publierBaremePsuSchema,
  publierBaremeTranchesSchema,
  publierGrilleAbcmSchema,
  publierGrilleSchema,
} from './referentiel.dto.js';

/** Postes tarifaires ABCM (centimes) partagés par une vue et une ligne de grille. */
interface PostesGrilleAbcm {
  readonly cantineTotalCentimes: number;
  readonly cantinePartGardeCentimes: number | null;
  readonly periMatinCentimes: number;
  readonly periSoirCentimes: number;
  readonly alshJourneeCompleteCentimes: number;
  readonly alshDemiJourneeCentimes: number;
  readonly alshRepasCentimes: number;
}

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

/** Vue d'un barème PSU publié (taux + bornes CNAF en centimes). */
export interface BaremePsuVue {
  readonly id: string;
  readonly valideDu: string;
  readonly valideAu: string | null;
  readonly taux: Record<string, number>;
  readonly plancherCentimes: number | null;
  readonly plafondCentimes: number | null;
}

/** Vue d'un barème de seuils de tranche publié (bornes hautes en centimes). */
export interface BaremeTranchesVue {
  readonly id: string;
  readonly valideDu: string;
  readonly valideAu: string | null;
  readonly seuils: readonly SeuilTranchePayload[];
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

export interface JourNonFacturableVue {
  readonly jour: string;
  readonly type: string;
  readonly libelle: string;
}

@Injectable()
export class ReferentielService {
  constructor(@Inject(DRIZZLE) private readonly db: Database) {}

  /**
   * Découpe les postes tarifaires d'une grille (vue ou ligne) en **paramètres du
   * mode projeté** (centimes) — cœur du payload `GrillePubliee.v2` (D1). Un mode =
   * un sous-ensemble de postes ; le consommateur reconstitue la grille du mode.
   */
  private projeterParametresGrille(
    postes: PostesGrilleAbcm,
    mode: (typeof MODES_ABCM_CONTRAT)[number],
  ): ParametresGrille {
    if (mode === 'CANTINE') {
      return {
        cantineTotalCentimes: postes.cantineTotalCentimes,
        cantinePartGardeCentimes: postes.cantinePartGardeCentimes,
      };
    }
    if (mode === 'PERISCOLAIRE') {
      return {
        periMatinCentimes: postes.periMatinCentimes,
        periSoirCentimes: postes.periSoirCentimes,
      };
    }
    return {
      alshJourneeCompleteCentimes: postes.alshJourneeCompleteCentimes,
      alshDemiJourneeCentimes: postes.alshDemiJourneeCentimes,
      alshRepasCentimes: postes.alshRepasCentimes,
    };
  }

  /**
   * Publie une grille ABCM versionnée : **valide l'entrée via Zod** (le schéma
   * n'étant plus branché sur un pipe HTTP, la validation vit ici pour couvrir
   * aussi les grilles seedées au boot), valide période/tranche via le domaine,
   * refuse un chevauchement avec une grille existante de la même tranche, puis
   * insère la grille et émet un `GrillePubliee.v2` **par mode ABCM** (payload
   * portant les montants du mode, D1/RM-30-04) dans la même transaction (outbox).
   * La grille est marquée `version_payload = 2` : elle ne sera pas ré-émise au boot.
   */
  async publierGrilleAbcm(entree: unknown): Promise<GrilleAbcmVue> {
    const dto = publierGrilleAbcmSchema.parse(entree);
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
      await tx.insert(grilleAbcm).values({ ...vue, versionPayload: 2 });
      for (const mode of MODES_ABCM_CONTRAT) {
        const payload: GrillePublieeV2Payload = {
          grilleId: id,
          mode,
          tranche: tranche.niveau,
          valideDu: dto.valideDu,
          valideAu: dto.valideAu ?? null,
          parametres: this.projeterParametresGrille(vue, mode),
        };
        await tx.insert(outbox).values({
          id: randomUUID(),
          type: GRILLE_PUBLIEE_V2_TYPE,
          payload,
          traceId: traceIdCourant(),
        });
      }
    });

    return vue;
  }

  /**
   * Publie une **grille complète** (SFD 30, US-30-02, lot 6) : une période de
   * validité et une ligne par tranche (montants euros), depuis l'écran « Tarifs ».
   * Vérifie l'absence de chevauchement **pour chaque tranche** (contre les grilles
   * existantes de la même tranche et les autres lignes du même niveau) **avant**
   * toute écriture, puis insère toutes les lignes et émet un `GrillePubliee.v2` par
   * `(mode, tranche)` dans **une seule transaction** — une période chevauchante
   * échoue donc sans aucune écriture partielle (« rien d'écrit »). Chaque ligne est
   * marquée `version_payload = 2` (jamais ré-émise au boot).
   */
  async publierGrille(entree: unknown): Promise<GrilleAbcmVue[]> {
    const dto = publierGrilleSchema.parse(entree);
    const periode = PeriodeValidite.creer(
      dto.valideDu,
      dto.valideAu ?? undefined,
    );

    // Vues à insérer + vérification anti-chevauchement par niveau de tranche.
    // On regroupe les lignes saisies par niveau : deux lignes d'un même niveau
    // (même période) se chevauchent → refus (aucune écriture).
    const vues: GrilleAbcmVue[] = [];
    const periodesParNiveau = new Map<number, PeriodeValidite[]>();
    for (const ligne of dto.tranches) {
      const tranche = trancheDepuisNiveau(ligne.tranche);
      const liste = periodesParNiveau.get(tranche.niveau) ?? [];
      liste.push(periode);
      periodesParNiveau.set(tranche.niveau, liste);
      vues.push({
        id: randomUUID(),
        tranche: tranche.niveau,
        valideDu: dto.valideDu,
        valideAu: dto.valideAu ?? null,
        cantineTotalCentimes: Money.depuisEuros(ligne.cantineTotal).centimes,
        cantinePartGardeCentimes:
          ligne.cantinePartGarde === undefined
            ? null
            : Money.depuisEuros(ligne.cantinePartGarde).centimes,
        periMatinCentimes: Money.depuisEuros(ligne.periMatin).centimes,
        periSoirCentimes: Money.depuisEuros(ligne.periSoir).centimes,
        alshJourneeCompleteCentimes: Money.depuisEuros(
          ligne.alshJourneeComplete,
        ).centimes,
        alshDemiJourneeCentimes: Money.depuisEuros(ligne.alshDemiJournee)
          .centimes,
        alshRepasCentimes: Money.depuisEuros(ligne.alshRepas).centimes,
      });
    }

    for (const [niveau, nouvellesPeriodes] of periodesParNiveau) {
      const existantes = await this.db
        .select()
        .from(grilleAbcm)
        .where(eq(grilleAbcm.tranche, niveau));
      verifierAbsenceChevauchement([
        ...existantes.map((g) =>
          PeriodeValidite.creer(g.valideDu, g.valideAu ?? undefined),
        ),
        ...nouvellesPeriodes,
      ]);
    }

    await this.db.transaction(async (tx) => {
      for (const vue of vues) {
        await tx.insert(grilleAbcm).values({ ...vue, versionPayload: 2 });
        for (const mode of MODES_ABCM_CONTRAT) {
          const payload: GrillePublieeV2Payload = {
            grilleId: vue.id,
            mode,
            tranche: vue.tranche,
            valideDu: vue.valideDu,
            valideAu: vue.valideAu,
            parametres: this.projeterParametresGrille(vue, mode),
          };
          await tx.insert(outbox).values({
            id: randomUUID(),
            type: GRILLE_PUBLIEE_V2_TYPE,
            payload,
            traceId: traceIdCourant(),
          });
        }
      }
    });

    return vues;
  }

  /**
   * Liste **toutes** les grilles ABCM publiées (SFD 30, lot 6), de la période la
   * plus récente à la plus ancienne (tranche croissante à période égale), pour
   * l'écran « Tarifs » : le parent regroupe les lignes par période et voit chaque
   * grille « en préparation / active / passée ». Lecture seule.
   */
  async listerGrilles(): Promise<GrilleAbcmVue[]> {
    const rows = await this.db
      .select()
      .from(grilleAbcm)
      .orderBy(desc(grilleAbcm.valideDu), asc(grilleAbcm.tranche));
    return rows.map((r) => ({
      id: r.id,
      tranche: trancheDepuisNiveau(r.tranche).niveau,
      valideDu: r.valideDu,
      valideAu: r.valideAu,
      cantineTotalCentimes: r.cantineTotalCentimes,
      cantinePartGardeCentimes: r.cantinePartGardeCentimes,
      periMatinCentimes: r.periMatinCentimes,
      periSoirCentimes: r.periSoirCentimes,
      alshJourneeCompleteCentimes: r.alshJourneeCompleteCentimes,
      alshDemiJourneeCentimes: r.alshDemiJourneeCentimes,
      alshRepasCentimes: r.alshRepasCentimes,
    }));
  }

  /**
   * Ré-émet en **v2** (une seule fois) les grilles publiées avant ce lot
   * (`version_payload < 2`) : en prod, `svc-tarification` n'a jamais reçu les
   * montants (v1 muette). Idempotent — une fois `version_payload` remonté à `2`,
   * plus rien à ré-émettre. Renvoie le nombre de grilles ré-émises (pour le log).
   */
  async reemettreGrillesEnV2(): Promise<number> {
    const aReemettre = await this.db
      .select()
      .from(grilleAbcm)
      .where(lt(grilleAbcm.versionPayload, 2));
    for (const grille of aReemettre) {
      await this.db.transaction(async (tx) => {
        for (const mode of MODES_ABCM_CONTRAT) {
          const payload: GrillePublieeV2Payload = {
            grilleId: grille.id,
            mode,
            tranche: trancheDepuisNiveau(grille.tranche).niveau,
            valideDu: grille.valideDu,
            valideAu: grille.valideAu,
            parametres: this.projeterParametresGrille(grille, mode),
          };
          await tx.insert(outbox).values({
            id: randomUUID(),
            type: GRILLE_PUBLIEE_V2_TYPE,
            payload,
            traceId: traceIdCourant(),
          });
        }
        await tx
          .update(grilleAbcm)
          .set({ versionPayload: 2 })
          .where(eq(grilleAbcm.id, grille.id));
      });
    }
    return aReemettre.length;
  }

  /**
   * Publie un barème PSU versionné (D2) : valide via Zod, refuse un chevauchement
   * de période, insère et émet `BaremePsuPublie.v1` dans la même transaction. Le
   * barème est marqué `version_payload = 1` (ne sera pas ré-émis au boot).
   */
  async publierBaremePsu(entree: unknown): Promise<BaremePsuVue> {
    const dto = publierBaremePsuSchema.parse(entree);
    const periode = PeriodeValidite.creer(
      dto.valideDu,
      dto.valideAu ?? undefined,
    );

    const existants = await this.db.select().from(baremePsu);
    verifierAbsenceChevauchement([
      ...existants.map((b) =>
        PeriodeValidite.creer(b.valideDu, b.valideAu ?? undefined),
      ),
      periode,
    ]);

    const id = randomUUID();
    const plancherCentimes =
      dto.plancher === undefined
        ? null
        : Money.depuisEuros(dto.plancher).centimes;
    const plafondCentimes =
      dto.plafond === undefined
        ? null
        : Money.depuisEuros(dto.plafond).centimes;
    const vue: BaremePsuVue = {
      id,
      valideDu: dto.valideDu,
      valideAu: dto.valideAu ?? null,
      taux: dto.taux,
      plancherCentimes,
      plafondCentimes,
    };

    await this.db.transaction(async (tx) => {
      await tx.insert(baremePsu).values({ ...vue, versionPayload: 1 });
      const payload: BaremePsuPubliePayload = {
        baremeId: id,
        valideDu: vue.valideDu,
        valideAu: vue.valideAu,
        taux: vue.taux,
        plancherCentimes,
        plafondCentimes,
      };
      await tx.insert(outbox).values({
        id: randomUUID(),
        type: BAREME_PSU_PUBLIE_TYPE,
        payload,
        traceId: traceIdCourant(),
      });
    });

    return vue;
  }

  /**
   * Ré-émet en `BaremePsuPublie.v1` (une seule fois) les barèmes seedés avant ce
   * lot (`version_payload < 1`) : le seed PSU n'émettait rien historiquement.
   * Idempotent. Renvoie le nombre de barèmes ré-émis.
   */
  async reemettreBaremesPsu(): Promise<number> {
    const aReemettre = await this.db
      .select()
      .from(baremePsu)
      .where(lt(baremePsu.versionPayload, 1));
    for (const bareme of aReemettre) {
      await this.db.transaction(async (tx) => {
        const payload: BaremePsuPubliePayload = {
          baremeId: bareme.id,
          valideDu: bareme.valideDu,
          valideAu: bareme.valideAu,
          taux: bareme.taux as Record<string, number>,
          plancherCentimes: bareme.plancherCentimes,
          plafondCentimes: bareme.plafondCentimes,
        };
        await tx.insert(outbox).values({
          id: randomUUID(),
          type: BAREME_PSU_PUBLIE_TYPE,
          payload,
          traceId: traceIdCourant(),
        });
        await tx
          .update(baremePsu)
          .set({ versionPayload: 1 })
          .where(eq(baremePsu.id, bareme.id));
      });
    }
    return aReemettre.length;
  }

  /**
   * Publie un barème de **seuils de tranche** versionné (SFD 30, DV-03) : valide via
   * Zod, refuse un chevauchement de période, convertit les bornes euros→centimes,
   * insère et émet `BaremeTranchesPublie.v1` dans la même transaction. Le barème est
   * marqué `version_payload = 1` (ne sera pas ré-émis au boot).
   */
  async publierBaremeTranches(entree: unknown): Promise<BaremeTranchesVue> {
    const dto = publierBaremeTranchesSchema.parse(entree);
    const periode = PeriodeValidite.creer(
      dto.valideDu,
      dto.valideAu ?? undefined,
    );

    const existants = await this.db.select().from(baremeTranches);
    verifierAbsenceChevauchement([
      ...existants.map((b) =>
        PeriodeValidite.creer(b.valideDu, b.valideAu ?? undefined),
      ),
      periode,
    ]);

    const id = randomUUID();
    const seuils: SeuilTranchePayload[] = dto.seuils.map((s) => ({
      niveau: s.niveau,
      rfrMaxCentimes:
        s.rfrMax === null ? null : Money.depuisEuros(s.rfrMax).centimes,
    }));
    const vue: BaremeTranchesVue = {
      id,
      valideDu: dto.valideDu,
      valideAu: dto.valideAu ?? null,
      seuils,
    };

    await this.db.transaction(async (tx) => {
      await tx.insert(baremeTranches).values({
        id,
        valideDu: vue.valideDu,
        valideAu: vue.valideAu,
        seuils,
        versionPayload: 1,
      });
      const payload: BaremeTranchesPubliePayload = {
        baremeId: id,
        valideDu: vue.valideDu,
        valideAu: vue.valideAu,
        seuils,
      };
      await tx.insert(outbox).values({
        id: randomUUID(),
        type: BAREME_TRANCHES_PUBLIE_TYPE,
        payload,
        traceId: traceIdCourant(),
      });
    });

    return vue;
  }

  /**
   * Ré-émet en `BaremeTranchesPublie.v1` (une seule fois) les barèmes de tranches
   * seedés avant ce lot (`version_payload < 1`). Idempotent. Renvoie le nombre
   * de barèmes ré-émis.
   */
  async reemettreBaremeTranches(): Promise<number> {
    const aReemettre = await this.db
      .select()
      .from(baremeTranches)
      .where(lt(baremeTranches.versionPayload, 1));
    for (const bareme of aReemettre) {
      await this.db.transaction(async (tx) => {
        const payload: BaremeTranchesPubliePayload = {
          baremeId: bareme.id,
          valideDu: bareme.valideDu,
          valideAu: bareme.valideAu,
          seuils: bareme.seuils as SeuilTranchePayload[],
        };
        await tx.insert(outbox).values({
          id: randomUUID(),
          type: BAREME_TRANCHES_PUBLIE_TYPE,
          payload,
          traceId: traceIdCourant(),
        });
        await tx
          .update(baremeTranches)
          .set({ versionPayload: 1 })
          .where(eq(baremeTranches.id, bareme.id));
      });
    }
    return aReemettre.length;
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
