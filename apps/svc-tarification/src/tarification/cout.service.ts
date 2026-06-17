import { Inject, Injectable, Logger } from '@nestjs/common';
import { and, eq, like } from 'drizzle-orm';
import {
  CoutMois,
  FraisFixesAbcm,
  consoliderCoutMoisFoyer,
} from '@creche-planner/tarification-domain';
import { DRIZZLE } from '@creche-planner/nest-commons';
import type { Database } from '../database/database.types.js';
import { contrat, foyer, prestationMois } from '../database/schema.js';
import { FoyerClient } from '../fallback/foyer.client.js';
import { PlanificationClient } from '../fallback/planification.client.js';
import {
  parsePrestationRm,
  valoriserPrestation,
  type FoyerCalcul,
  type PrestationRM,
} from './cout.mapper.js';

/** Détail d'une ligne de coût sérialisée (montant en centimes). */
export interface LigneVue {
  readonly libelle: string;
  readonly sens: 'debit' | 'credit';
  readonly montantCentimes: number;
}

/** Coût d'un (enfant, mode) pour le mois. */
export interface CoutPrestationVue {
  readonly enfant: string;
  readonly mode: string;
  readonly totalCentimes: number;
  readonly lignes: readonly LigneVue[];
}

/** Coût consolidé d'un foyer pour un mois. */
export interface CoutMoisVue {
  readonly foyerId: string;
  readonly mois: string;
  readonly simule: boolean;
  readonly totalCentimes: number;
  readonly prestations: readonly CoutPrestationVue[];
  readonly lignes: readonly LigneVue[];
}

/** Coût annuel d'un foyer (12 mois + total). */
export interface CoutAnnuelVue {
  readonly foyerId: string;
  readonly annee: number;
  readonly simule: boolean;
  readonly totalCentimes: number;
  readonly mois: readonly CoutMoisVue[];
}

/** Une prestation projetée du read model, prête à valoriser. */
interface PrestationProjetee {
  readonly enfant: string;
  readonly mode: string;
  readonly prestation: PrestationRM;
}

/** Ligne de la table read-model `contrat` (identité foyer/enfant/mode). */
type ContratRow = (typeof contrat)['$inferSelect'];

/** Ligne de la projection `prestation_mois` (quantités d'un contrat sur un mois). */
type PrestationMoisRow = (typeof prestationMois)['$inferSelect'];

const MODES_ABCM = new Set(['CANTINE', 'PERISCOLAIRE', 'ALSH']);
const MOIS_FRAIS_FIXES = 9; // septembre (doc 02 §4.4)

/**
 * Orchestration du **coût du mois/an** (doc 06 §10.4). Lit le read model
 * (`foyer`, `prestation_mois`), bascule sur les clients de repli synchrone si une
 * projection est froide/incomplète, puis délègue **tout** le calcul au domaine
 * `@creche-planner/tarification-domain` (stratégies PSU/ABCM + consolidation foyer).
 * Aucune formule tarifaire ici : seulement la lecture/le repli et l'assemblage.
 */
@Injectable()
export class CoutService {
  private readonly logger = new Logger(CoutService.name);

  /**
   * Calculs annuels **en vol**, indexés par `(foyer, année, simulé)`. Le coût
   * annuel est CPU-intensif (12 mois valorisés sur l'unique event loop) : sous
   * charge, plusieurs requêtes **identiques** concurrentes (cas de la validation
   * E2E / des polls navigateur) se sérialisaient et frôlaient le repli 502. On les
   * **coalesce** : la 1ʳᵉ déclenche le calcul, les suivantes partagent sa promesse.
   * Pas de cache TTL → aucune péremption (eventual consistency préservée).
   */
  private readonly annuelEnVol = new Map<string, Promise<CoutAnnuelVue>>();

  constructor(
    @Inject(DRIZZLE) private readonly db: Database,
    private readonly foyerClient: FoyerClient,
    private readonly planificationClient: PlanificationClient,
  ) {}

  /** Coût consolidé d'un foyer pour un mois (réel ou simulé). */
  async coutMois(
    foyerId: string,
    mois: string,
    simule: boolean,
  ): Promise<CoutMoisVue> {
    const [donneesFoyer, contrats, projetees] = await Promise.all([
      this.chargerFoyer(foyerId),
      this.chargerContrats(foyerId),
      this.chargerProjeteesMois(foyerId, mois, simule),
    ]);
    return this.calculerCoutMois(
      foyerId,
      mois,
      simule,
      donneesFoyer,
      contrats,
      projetees,
    );
  }

  /**
   * Calcule le coût d'un mois à partir de données **déjà chargées** (foyer +
   * contrats + projections `prestation_mois` du mois). Factorisé pour que le coût
   * annuel charge tout en amont (3 requêtes) et réutilise ce noyau — purement
   * CPU + repli ponctuel — pour les 12 mois en parallèle.
   */
  private async calculerCoutMois(
    foyerId: string,
    mois: string,
    simule: boolean,
    donneesFoyer: FoyerCalcul,
    contrats: readonly ContratRow[],
    projetees: readonly PrestationMoisRow[],
  ): Promise<CoutMoisVue> {
    const projections = await this.assemblerPrestations(
      mois,
      simule,
      contrats,
      projetees,
    );

    const prestations: CoutPrestationVue[] = [];
    const couts: CoutMois[] = [];
    let auMoinsUnAbcm = false;

    for (const projection of projections) {
      if (MODES_ABCM.has(projection.mode)) {
        auMoinsUnAbcm = true;
      }
      const cout = valoriserPrestation(projection.prestation, donneesFoyer);
      couts.push(cout);
      prestations.push({
        enfant: projection.enfant,
        mode: projection.mode,
        totalCentimes: cout.total.centimes,
        lignes: this.serialiserLignes(cout),
      });
    }

    // Frais fixes annuels ABCM, rattachés à septembre (doc 02 §4.4, CT-13/CT-20).
    if (auMoinsUnAbcm && this.estMoisFraisFixes(mois)) {
      const coutFrais = new FraisFixesAbcm().calculerCoutMois({
        mois: MOIS_FRAIS_FIXES,
        premiereAnnee: this.estPremiereAnneeAbcm(mois),
      });
      if (!coutFrais.estVide()) {
        couts.push(coutFrais);
        prestations.push({
          enfant: '',
          mode: 'FRAIS_FIXES_ABCM',
          totalCentimes: coutFrais.total.centimes,
          lignes: this.serialiserLignes(coutFrais),
        });
      }
    }

    const consolide = consoliderCoutMoisFoyer(couts);
    return {
      foyerId,
      mois,
      simule,
      totalCentimes: consolide.total.centimes,
      prestations,
      lignes: this.serialiserLignes(consolide),
    };
  }

  /**
   * Coût annuel : 12 mois projetés + total. Le foyer et les contrats (identiques
   * pour les 12 mois) sont chargés **une seule fois**, puis les mois sont calculés
   * **en parallèle** : la latence devient celle du mois le plus lent — pas la somme
   * des douze — et l'agrégation ne bascule plus en repli 502 de la gateway.
   */
  async coutAnnuel(
    foyerId: string,
    annee: number,
    simule: boolean,
  ): Promise<CoutAnnuelVue> {
    const cle = `${foyerId}|${annee}|${simule}`;
    const enVol = this.annuelEnVol.get(cle);
    if (enVol) {
      return enVol;
    }
    const promesse = this.calculerCoutAnnuel(foyerId, annee, simule).finally(
      () => this.annuelEnVol.delete(cle),
    );
    this.annuelEnVol.set(cle, promesse);
    return promesse;
  }

  /** Calcul effectif du coût annuel (cf. `coutAnnuel` pour la coalescence). */
  private async calculerCoutAnnuel(
    foyerId: string,
    annee: number,
    simule: boolean,
  ): Promise<CoutAnnuelVue> {
    const [donneesFoyer, contrats, projeteesAnnee] = await Promise.all([
      this.chargerFoyer(foyerId),
      this.chargerContrats(foyerId),
      this.chargerProjeteesAnnee(foyerId, annee, simule),
    ]);
    const mois = await Promise.all(
      Array.from({ length: 12 }, (_, i) => {
        const moisIso = `${annee}-${String(i + 1).padStart(2, '0')}`;
        return this.calculerCoutMois(
          foyerId,
          moisIso,
          simule,
          donneesFoyer,
          contrats,
          projeteesAnnee.get(moisIso) ?? [],
        );
      }),
    );
    const total = mois.reduce((somme, m) => somme + m.totalCentimes, 0);
    return { foyerId, annee, simule, totalCentimes: total, mois };
  }

  /**
   * Charge le foyer depuis le read model ; si la projection est froide (absente),
   * bascule sur le client de repli synchrone `svc-foyer`. À défaut, un foyer neutre
   * (T3, 1 enfant à charge, ressources 0) est renvoyé pour ne pas planter — les
   * coûts PSU seront simplement nuls et l'ABCM s'appuiera sur la grille T3.
   */
  private async chargerFoyer(foyerId: string): Promise<FoyerCalcul> {
    const lignes = await this.db
      .select()
      .from(foyer)
      .where(eq(foyer.id, foyerId));
    const ligne = lignes[0];
    if (ligne) {
      return {
        ressourcesMensuellesCentimes: ligne.ressourcesMensuellesCentimes,
        nbEnfantsACharge: ligne.nbEnfantsACharge,
        tranche: ligne.tranche as 1 | 2 | 3,
      };
    }
    this.logger.warn(
      `Foyer ${foyerId} absent du read model — repli synchrone svc-foyer`,
    );
    const repli = await this.foyerClient.foyer(foyerId);
    if (repli) {
      return {
        ressourcesMensuellesCentimes: repli.ressourcesMensuellesCentimes,
        nbEnfantsACharge: repli.nbEnfantsACharge,
        tranche: repli.tranche,
      };
    }
    return {
      ressourcesMensuellesCentimes: 0,
      nbEnfantsACharge: 1,
      tranche: 3,
    };
  }

  /** Identité des contrats du foyer (indépendante du mois). */
  private chargerContrats(foyerId: string): Promise<ContratRow[]> {
    return this.db.select().from(contrat).where(eq(contrat.foyerId, foyerId));
  }

  /** Projections `prestation_mois` d'un mois donné (read model). */
  private chargerProjeteesMois(
    foyerId: string,
    mois: string,
    simule: boolean,
  ): Promise<PrestationMoisRow[]> {
    return this.db
      .select()
      .from(prestationMois)
      .where(
        and(
          eq(prestationMois.foyerId, foyerId),
          eq(prestationMois.mois, mois),
          eq(prestationMois.simule, simule),
        ),
      );
  }

  /**
   * Projections `prestation_mois` des 12 mois de l'année en **une seule requête**,
   * groupées par mois ISO (`YYYY-MM`). L'annuel LIT le read model en bloc plutôt
   * que de le ré-interroger mois par mois : 1 requête au lieu de 12, ce qui limite
   * la contention sur le pool de connexions sous charge concurrente.
   */
  private async chargerProjeteesAnnee(
    foyerId: string,
    annee: number,
    simule: boolean,
  ): Promise<Map<string, PrestationMoisRow[]>> {
    const lignes = await this.db
      .select()
      .from(prestationMois)
      .where(
        and(
          eq(prestationMois.foyerId, foyerId),
          like(prestationMois.mois, `${annee}-%`),
          eq(prestationMois.simule, simule),
        ),
      );
    const parMois = new Map<string, PrestationMoisRow[]>();
    for (const ligne of lignes) {
      const groupe = parMois.get(ligne.mois);
      if (groupe) {
        groupe.push(ligne);
      } else {
        parMois.set(ligne.mois, [ligne]);
      }
    }
    return parMois;
  }

  /**
   * Assemble les prestations du mois pour tous les contrats du foyer, à partir des
   * projections `prestation_mois` **déjà chargées**. Pour chaque contrat connu
   * (`contrats`), on prend la projection si présente ; si elle est **froide**
   * (absente pour ce mois/simulé), on bascule sur un **repli synchrone**
   * `svc-planification` (timeout/retry/CB) pour la reconstituer à la volée.
   * Dégradation propre : un contrat dont le repli échoue est simplement omis
   * (pas de crash de l'endpoint).
   */
  private async assemblerPrestations(
    mois: string,
    simule: boolean,
    contrats: readonly ContratRow[],
    projetees: readonly PrestationMoisRow[],
  ): Promise<PrestationProjetee[]> {
    const parContrat = new Map(projetees.map((p) => [p.contratId, p]));
    const resultat: PrestationProjetee[] = [];

    for (const c of contrats) {
      const projetee = parContrat.get(c.id);
      if (projetee) {
        resultat.push({
          enfant: projetee.enfant,
          mode: projetee.mode,
          prestation: parsePrestationRm(projetee.prestations),
        });
        continue;
      }
      // Read model froid pour ce contrat : repli synchrone Planification.
      const repli = await this.planificationClient.prestations(
        c.id,
        mois,
        simule,
      );
      const prestation = repli?.prestations[0];
      if (prestation) {
        resultat.push({
          enfant: c.enfant,
          mode: c.mode,
          // Validation Zod (AQ-03) : le repli ne garantit que le `mode` ; le
          // reste est revalidé ici — payload non conforme = contrat amont
          // rompu, erreur explicite (≠ échec réseau du repli, qui omet).
          prestation: parsePrestationRm(prestation),
        });
      }
    }

    // Cas limite : projections présentes pour des contrats inconnus de la table
    // `contrat` (ContratCree non reçu) — on les inclut tout de même.
    for (const p of projetees) {
      if (!contrats.some((c) => c.id === p.contratId)) {
        resultat.push({
          enfant: p.enfant,
          mode: p.mode,
          prestation: parsePrestationRm(p.prestations),
        });
      }
    }

    return resultat;
  }

  private serialiserLignes(cout: CoutMois): LigneVue[] {
    return cout.lignes.map((ligne) => ({
      libelle: ligne.libelle,
      sens: ligne.sens,
      montantCentimes: ligne.montant.centimes,
    }));
  }

  private estMoisFraisFixes(mois: string): boolean {
    return Number(mois.slice(5, 7)) === MOIS_FRAIS_FIXES;
  }

  /**
   * 1ʳᵉ année ABCM = septembre 2026 (entrée à l'école de Zoé, doc 02 §8). Les
   * frais de 1ère inscription ne s'ajoutent qu'alors ; les années suivantes ne
   * portent que la cotisation.
   */
  private estPremiereAnneeAbcm(mois: string): boolean {
    return mois.slice(0, 4) === '2026';
  }
}
