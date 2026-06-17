import {
  Inject,
  Injectable,
  Logger,
  type OnApplicationBootstrap,
  type OnApplicationShutdown,
} from '@nestjs/common';
import { Money } from '@creche-planner/shared-kernel';
import { DRIZZLE } from '@creche-planner/nest-commons';
import type { Database } from '../database/database.types.js';
import {
  baremePsu,
  fraisFixesAbcm,
  grilleAbcm,
  jourNonFacturable,
} from '../database/schema.js';
import { ReferentielService } from './referentiel.service.js';
import type { PublierGrilleAbcmDto } from './referentiel.dto.js';

/** Grilles ABCM 2026 réelles par tranche (doc 02 §4), montants en euros. */
const GRILLES_2026: readonly PublierGrilleAbcmDto[] = [
  {
    tranche: 1,
    valideDu: '2026-01-01',
    valideAu: null,
    cantineTotal: 10.5,
    periMatin: 2.31,
    periSoir: 5.01,
    alshJourneeComplete: 23.5,
    alshDemiJournee: 8.5,
    alshRepas: 6.5,
  },
  {
    tranche: 2,
    valideDu: '2026-01-01',
    valideAu: null,
    cantineTotal: 11.65,
    periMatin: 2.87,
    periSoir: 6.01,
    alshJourneeComplete: 25.0,
    alshDemiJournee: 9.0,
    alshRepas: 7.0,
  },
  {
    tranche: 3,
    valideDu: '2026-01-01',
    valideAu: null,
    cantineTotal: 12.68,
    cantinePartGarde: 8.01,
    periMatin: 3.33,
    periSoir: 7.05,
    alshJourneeComplete: 26.5,
    alshDemiJournee: 9.5,
    alshRepas: 7.5,
  },
];

/** Barème CNAF du taux d'effort PSU 2026 (doc 02 §3.3). */
const TAUX_EFFORT_PSU_2026 = {
  '1': 0.000619,
  '2': 0.000516,
  '3': 0.000413,
  '4': 0.00031,
  '5': 0.00031,
  '6': 0.00031,
  '7': 0.00031,
  '8': 0.000206,
};

/** Fermetures crèche 2026 (doc 02 §7), non facturables (INV-04). */
const FERMETURES_2026: readonly string[] = [
  '2026-01-01',
  '2026-01-02',
  '2026-01-03',
  '2026-01-04',
  '2026-04-06',
  '2026-05-01',
  '2026-05-08',
  '2026-05-14',
  '2026-05-15',
  '2026-05-16',
  '2026-05-17',
  '2026-05-25',
  '2026-07-14',
  '2026-07-27',
  '2026-07-28',
  '2026-07-29',
  '2026-07-30',
  '2026-07-31',
];

/**
 * Amorce le catalogue avec les données de référence 2026 (doc 02) si la base est vide.
 * **Idempotent** (insère seulement quand une table est vide) et **résilient** :
 * réessaie en arrière-plan si la base n'est pas encore prête au démarrage.
 * Tourne après `MigrationService` (`OnModuleInit` → tables créées avant le boot).
 */
@Injectable()
export class SeedService
  implements OnApplicationBootstrap, OnApplicationShutdown
{
  private readonly logger = new Logger(SeedService.name);
  private retry?: ReturnType<typeof setTimeout>;

  constructor(
    @Inject(DRIZZLE) private readonly db: Database,
    private readonly referentiel: ReferentielService,
  ) {}

  onApplicationBootstrap(): void {
    void this.amorcer();
  }

  private async amorcer(): Promise<void> {
    try {
      await this.amorcerGrilles();
      await this.amorcerBaremePsu();
      await this.amorcerFraisFixes();
      await this.amorcerFermetures();
    } catch (erreur) {
      this.logger.warn(
        `Amorçage du catalogue impossible (${(erreur as Error).message}) — nouvel essai dans 5 s`,
      );
      this.retry = setTimeout(() => void this.amorcer(), 5000);
    }
  }

  private async amorcerGrilles(): Promise<void> {
    const dejaLa = await this.db.select().from(grilleAbcm).limit(1);
    if (dejaLa.length > 0) {
      return;
    }
    for (const grille of GRILLES_2026) {
      await this.referentiel.publierGrilleAbcm(grille);
    }
    this.logger.log('Grilles ABCM 2026 amorcées (T1/T2/T3) + GrillePubliee');
  }

  private async amorcerBaremePsu(): Promise<void> {
    const dejaLa = await this.db.select().from(baremePsu).limit(1);
    if (dejaLa.length > 0) {
      return;
    }
    await this.db.insert(baremePsu).values({
      valideDu: '2026-01-01',
      valideAu: null,
      taux: TAUX_EFFORT_PSU_2026,
      plancherCentimes: null,
      plafondCentimes: null,
    });
    this.logger.log('Barème PSU 2026 amorcé');
  }

  private async amorcerFraisFixes(): Promise<void> {
    const dejaLa = await this.db.select().from(fraisFixesAbcm).limit(1);
    if (dejaLa.length > 0) {
      return;
    }
    await this.db.insert(fraisFixesAbcm).values({
      valideDu: '2026-01-01',
      valideAu: null,
      cotisation1EnfantCentimes: Money.depuisEuros(286).centimes,
      premiereInscriptionCentimes: Money.depuisEuros(150).centimes,
    });
    this.logger.log('Frais fixes ABCM 2026 amorcés');
  }

  private async amorcerFermetures(): Promise<void> {
    const dejaLa = await this.db.select().from(jourNonFacturable).limit(1);
    if (dejaLa.length > 0) {
      return;
    }
    await this.db.insert(jourNonFacturable).values(
      FERMETURES_2026.map((jour) => ({
        jour,
        type: 'FERMETURE_CRECHE',
        libelle: 'Fermeture crèche 2026',
      })),
    );
    this.logger.log(
      `Fermetures crèche 2026 amorcées (${FERMETURES_2026.length})`,
    );
  }

  onApplicationShutdown(): void {
    if (this.retry) {
      clearTimeout(this.retry);
    }
  }
}
