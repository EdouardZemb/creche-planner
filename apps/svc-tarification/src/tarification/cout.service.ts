import {
  Inject,
  Injectable,
  Logger,
  ServiceUnavailableException,
} from '@nestjs/common';
import { and, eq, like } from 'drizzle-orm';
import { MODES_ABCM } from '@creche-planner/contracts-kernel';
import {
  AucuneVersionApplicableError,
  Money,
  depuisBornes,
  depuisSuite,
  selectionnerVersionApplicable,
} from '@creche-planner/shared-kernel';
import {
  BaremeEffortPsu,
  CoutMois,
  FraisFixesAbcm,
  GrilleAbcm,
  consoliderCoutMoisFoyer,
  estPremiereAnneeAbcm,
  type ParametresGrilleAbcm,
} from '@creche-planner/tarification-domain';
import { DRIZZLE } from '@creche-planner/nest-commons';
import type { Database } from '../database/database.types.js';
import {
  baremePsu,
  contrat,
  foyer,
  foyerVersion,
  grilleTarifaire,
  prestationMois,
  type BaremePsuRow,
  type FoyerVersionRow,
  type GrilleTarifaireRow,
} from '../database/schema.js';
import { FoyerClient } from '../fallback/foyer.client.js';
import { PlanificationClient } from '../fallback/planification.client.js';
import {
  ReferentielClient,
  type BaremePsuFallback,
  type GrilleApplicableFallback,
} from '../fallback/referentiel.client.js';
import {
  parsePrestationRm,
  valoriserPrestation,
  type ContexteTarif,
  type FoyerCalcul,
  type PrestationRM,
} from './cout.mapper.js';

/** Vrai si les paramètres projetés portent le montant nécessaire au `mode` ABCM. */
function aMontantsGrille(
  parametres: ParametresGrilleAbcm,
  mode: string,
): boolean {
  if (mode === 'CANTINE') {
    return parametres.cantineTotalCentimes !== undefined;
  }
  if (mode === 'PERISCOLAIRE') {
    return parametres.periMatinCentimes !== undefined;
  }
  return parametres.alshJourneeCompleteCentimes !== undefined;
}

/**
 * Traduit une réponse REST `/grilles/applicable` (repli) en paramètres du domaine.
 * Le Référentiel projette des noms de champs par mode (`totalCentimes`, `matinCentimes`…)
 * distincts de la forme événement ; on les remappe vers `ParametresGrilleAbcm`.
 */
function parametresDepuisRepli(
  repli: GrilleApplicableFallback,
  mode: string,
): ParametresGrilleAbcm {
  const brut = repli as unknown as Record<string, unknown>;
  // exactOptionalPropertyTypes : n'inclure une clé que si le montant est présent.
  const n = (cle: string): number | undefined => {
    const valeur = brut[cle];
    return typeof valeur === 'number' ? valeur : undefined;
  };
  if (mode === 'CANTINE') {
    const total = n('totalCentimes');
    return {
      ...(total !== undefined ? { cantineTotalCentimes: total } : {}),
      cantinePartGardeCentimes: n('partGardeCentimes') ?? null,
    };
  }
  if (mode === 'PERISCOLAIRE') {
    const matin = n('matinCentimes');
    const soir = n('soirCentimes');
    return {
      ...(matin !== undefined ? { periMatinCentimes: matin } : {}),
      ...(soir !== undefined ? { periSoirCentimes: soir } : {}),
    };
  }
  const journee = n('journeeCompleteCentimes');
  const demi = n('demiJourneeCentimes');
  const repas = n('repasCentimes');
  return {
    ...(journee !== undefined ? { alshJourneeCompleteCentimes: journee } : {}),
    ...(demi !== undefined ? { alshDemiJourneeCentimes: demi } : {}),
    ...(repas !== undefined ? { alshRepasCentimes: repas } : {}),
  };
}

/** Assemble un contexte PSU (barème + bornes) depuis taux et bornes en centimes. */
function contexteBaremePsu(
  taux: Record<string, number>,
  plancherCentimes: number | null,
  plafondCentimes: number | null,
): ContexteTarif {
  return {
    baremePsu: new BaremeEffortPsu(taux),
    ...(plancherCentimes !== null
      ? { plancher: Money.depuisCentimes(plancherCentimes) }
      : {}),
    ...(plafondCentimes !== null
      ? { plafond: Money.depuisCentimes(plafondCentimes) }
      : {}),
  };
}

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

/**
 * Contexte foyer chargé **une fois** par requête coût : l'historique versionné
 * (`versions`, v3) et la ligne « courante » de repli (`courant`, v1/v2 ou REST).
 * `resoudreFoyerAuMois` en tire les ressources du mois demandé.
 */
interface FoyerContexte {
  readonly versions: readonly FoyerVersionRow[];
  readonly courant: FoyerCalcul | undefined;
}

/** Ligne de la table read-model `contrat` (identité foyer/enfant/mode). */
type ContratRow = (typeof contrat)['$inferSelect'];

/** Ligne de la projection `prestation_mois` (quantités d'un contrat sur un mois). */
type PrestationMoisRow = (typeof prestationMois)['$inferSelect'];

/** Modes ABCM (SFD 30 §H4, source unique `@creche-planner/contracts-kernel`). */
const MODES_ABCM_SET = new Set<string>(MODES_ABCM);
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
    private readonly referentielClient: ReferentielClient,
  ) {}

  /** Coût consolidé d'un foyer pour un mois (réel ou simulé). */
  async coutMois(
    foyerId: string,
    mois: string,
    simule: boolean,
  ): Promise<CoutMoisVue> {
    const [contexteFoyer, contrats, projetees, grilles, baremes] =
      await Promise.all([
        this.chargerFoyerContexte(foyerId),
        this.chargerContrats(foyerId),
        this.chargerProjeteesMois(foyerId, mois, simule),
        this.chargerGrilles(),
        this.chargerBaremes(),
      ]);
    return this.calculerCoutMois(
      foyerId,
      mois,
      simule,
      contexteFoyer,
      contrats,
      projetees,
      grilles,
      baremes,
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
    contexteFoyer: FoyerContexte,
    contrats: readonly ContratRow[],
    projetees: readonly PrestationMoisRow[],
    grilles: readonly GrilleTarifaireRow[],
    baremes: readonly BaremePsuRow[],
  ): Promise<CoutMoisVue> {
    // Ressources résolues à la version applicable au 1er du mois (SFD 30, DV-03).
    const donneesFoyer = this.resoudreFoyerAuMois(contexteFoyer, mois);
    const projections = await this.assemblerPrestations(
      mois,
      simule,
      contrats,
      projetees,
    );

    // Résolution des paramètres tarifaires au 1er du mois (H7 : mensuel au 1er ;
    // les grilles ABCM changent à leur date d'effet, résolues au niveau du mois).
    const dateResolution = `${mois}-01`;

    const prestations: CoutPrestationVue[] = [];
    const couts: CoutMois[] = [];
    let auMoinsUnAbcm = false;

    for (const projection of projections) {
      if (MODES_ABCM_SET.has(projection.mode)) {
        auMoinsUnAbcm = true;
      }
      const contexte = await this.resoudreContexteTarif(
        projection.mode,
        donneesFoyer.tranche,
        dateResolution,
        grilles,
        baremes,
      );
      const cout = valoriserPrestation(
        projection.prestation,
        donneesFoyer,
        contexte,
      );
      couts.push(cout);
      prestations.push({
        enfant: projection.enfant,
        mode: projection.mode,
        totalCentimes: cout.total.centimes,
        lignes: this.serialiserLignes(cout),
      });
    }

    // Frais fixes annuels ABCM, rattachés à septembre (doc 02 §4.4, CT-13/CT-20).
    // La « première année » découle des contrats du foyer (champ
    // `premiereInscription` + année scolaire de `valideDu`) — règle du domaine.
    if (auMoinsUnAbcm && this.estMoisFraisFixes(mois)) {
      const coutFrais = new FraisFixesAbcm().calculerCoutMois({
        mois: MOIS_FRAIS_FIXES,
        premiereAnnee: estPremiereAnneeAbcm(
          mois,
          contrats.map((c) => ({
            modeAbcm: MODES_ABCM_SET.has(c.mode),
            premiereInscription: c.premiereInscription,
            valideDu: c.valideDu,
          })),
        ),
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
    const [contexteFoyer, contrats, projeteesAnnee, grilles, baremes] =
      await Promise.all([
        this.chargerFoyerContexte(foyerId),
        this.chargerContrats(foyerId),
        this.chargerProjeteesAnnee(foyerId, annee, simule),
        this.chargerGrilles(),
        this.chargerBaremes(),
      ]);
    const mois = await Promise.all(
      Array.from({ length: 12 }, (_, i) => {
        const moisIso = `${annee}-${String(i + 1).padStart(2, '0')}`;
        return this.calculerCoutMois(
          foyerId,
          moisIso,
          simule,
          contexteFoyer,
          contrats,
          projeteesAnnee.get(moisIso) ?? [],
          grilles,
          baremes,
        );
      }),
    );
    const total = mois.reduce((somme, m) => somme + m.totalCentimes, 0);
    return { foyerId, annee, simule, totalCentimes: total, mois };
  }

  /**
   * Charge le **contexte foyer** nécessaire pour résoudre les ressources **à chaque
   * mois** (SFD 30, DV-03) : l'historique versionné `foyer_version` (v3) et, en repli,
   * la ligne « courante » mono-version de `foyer` (v1/v2) ou le client REST svc-foyer.
   * Si rien n'est résoluble → **503 explicite** (jamais de ressources fausses — c'est
   * de l'argent). Chargé **une fois** ; `resoudreFoyerAuMois` en tire la version du mois.
   */
  private async chargerFoyerContexte(foyerId: string): Promise<FoyerContexte> {
    const [versions, lignes] = await Promise.all([
      this.db
        .select()
        .from(foyerVersion)
        .where(eq(foyerVersion.foyerId, foyerId)),
      this.db.select().from(foyer).where(eq(foyer.id, foyerId)),
    ]);
    const ligne = lignes[0];
    const courant: FoyerCalcul | undefined = ligne
      ? {
          ressourcesMensuellesCentimes: ligne.ressourcesMensuellesCentimes,
          nbEnfantsACharge: ligne.nbEnfantsACharge,
          tranche: ligne.tranche as 1 | 2 | 3,
        }
      : undefined;
    if (versions.length > 0) {
      return { versions, courant };
    }
    if (courant) {
      return { versions: [], courant };
    }
    this.logger.warn(
      `Foyer ${foyerId} absent du read model — repli synchrone svc-foyer`,
    );
    const repli = await this.foyerClient.foyer(foyerId);
    if (repli) {
      return {
        versions: [],
        courant: {
          ressourcesMensuellesCentimes: repli.ressourcesMensuellesCentimes,
          nbEnfantsACharge: repli.nbEnfantsACharge,
          tranche: repli.tranche,
        },
      };
    }
    this.logger.error(
      `Foyer ${foyerId} indisponible : read model froid et repli svc-foyer en échec`,
    );
    throw new ServiceUnavailableException(
      `foyer ${foyerId} indisponible : read model froid et repli svc-foyer en échec`,
    );
  }

  /**
   * Résout les ressources applicables **au 1er du mois** (H7). Sur un foyer versionné
   * (v3), sélectionne la version couvrant le mois — une date antérieure à la plus
   * ancienne version se **rabat** dessus (comportement mono-version pour le passé).
   * Sinon retombe sur la ligne « courante » (v1/v2 ou repli) : mêmes ressources tous
   * les mois, comportement **inchangé** pour un foyer non versionné.
   */
  private resoudreFoyerAuMois(
    contexte: FoyerContexte,
    mois: string,
  ): FoyerCalcul {
    if (contexte.versions.length === 0) {
      if (!contexte.courant) {
        throw new ServiceUnavailableException(
          `foyer indisponible pour le mois ${mois}`,
        );
      }
      return contexte.courant;
    }
    const date = `${mois}-01`;
    const triees = [...contexte.versions].sort((a, b) =>
      a.dateEffet < b.dateEffet ? -1 : a.dateEffet > b.dateEffet ? 1 : 0,
    );
    const premiere = triees[0];
    const v =
      premiere && date < premiere.dateEffet
        ? premiere
        : selectionnerVersionApplicable(
            depuisSuite(
              triees.map((r) => ({ dateEffet: r.dateEffet, valeur: r })),
            ),
            date,
          ).valeur;
    return {
      ressourcesMensuellesCentimes: v.ressourcesMensuellesCentimes,
      nbEnfantsACharge: v.nbEnfantsACharge,
      tranche: v.tranche as 1 | 2 | 3,
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

  /** Grilles tarifaires projetées (toutes versions/modes, table petite). */
  private chargerGrilles(): Promise<GrilleTarifaireRow[]> {
    return this.db.select().from(grilleTarifaire);
  }

  /** Barèmes PSU projetés (toutes versions, table petite). */
  private chargerBaremes(): Promise<BaremePsuRow[]> {
    return this.db.select().from(baremePsu);
  }

  /**
   * Résout le **contexte tarifaire** d'une prestation à `date` : barème PSU pour la
   * crèche, grille ABCM `(mode, tranche)` sinon. Read-model d'abord, repli REST
   * ensuite ; **503 explicite** si aucune version n'est résoluble ni localement ni
   * en repli (jamais de montant faux — c'est de l'argent).
   */
  private async resoudreContexteTarif(
    mode: string,
    tranche: 1 | 2 | 3,
    date: string,
    grilles: readonly GrilleTarifaireRow[],
    baremes: readonly BaremePsuRow[],
  ): Promise<ContexteTarif> {
    if (mode === 'CRECHE_PSU') {
      return this.resoudreBaremePsu(date, baremes);
    }
    return { grille: await this.resoudreGrille(mode, tranche, date, grilles) };
  }

  /** Grille ABCM applicable à `(mode, tranche, date)` — read-model puis repli REST. */
  private async resoudreGrille(
    mode: string,
    tranche: 1 | 2 | 3,
    date: string,
    grilles: readonly GrilleTarifaireRow[],
  ): Promise<GrilleAbcm> {
    const versions = grilles
      .filter((g) => g.mode === mode && g.tranche === tranche)
      .map((g) => ({
        valideDu: g.valideDu,
        valideAu: g.valideAu,
        valeur: g.parametres as ParametresGrilleAbcm,
      }));
    const local = this.selectionner(versions, date);
    if (local && aMontantsGrille(local, mode)) {
      return GrilleAbcm.depuisParametres(local);
    }
    this.logger.warn(
      `Grille ${mode}/T${tranche} au ${date} absente du read model — repli svc-referentiel`,
    );
    const repli = await this.referentielClient.grilleApplicable(
      date,
      tranche,
      mode,
    );
    if (repli) {
      return GrilleAbcm.depuisParametres(parametresDepuisRepli(repli, mode));
    }
    this.logger.error(
      `Grille ${mode}/T${tranche} au ${date} indisponible : read model froid et repli svc-referentiel en échec`,
    );
    throw new ServiceUnavailableException(
      `grille ${mode}/T${tranche} au ${date} indisponible : read model froid et repli svc-referentiel en échec`,
    );
  }

  /** Barème PSU applicable à `date` — read-model puis repli REST, sinon 503. */
  private async resoudreBaremePsu(
    date: string,
    baremes: readonly BaremePsuRow[],
  ): Promise<ContexteTarif> {
    const versions = baremes.map((b) => ({
      valideDu: b.valideDu,
      valideAu: b.valideAu,
      valeur: b,
    }));
    const local = this.selectionner(versions, date);
    if (local) {
      return contexteBaremePsu(
        local.taux as Record<string, number>,
        local.plancherCentimes,
        local.plafondCentimes,
      );
    }
    this.logger.warn(
      `Barème PSU au ${date} absent du read model — repli svc-referentiel`,
    );
    const repli: BaremePsuFallback | undefined =
      await this.referentielClient.baremePsuApplicable(date);
    if (repli) {
      return contexteBaremePsu(
        repli.taux,
        repli.plancherCentimes,
        repli.plafondCentimes,
      );
    }
    this.logger.error(
      `Barème PSU au ${date} indisponible : read model froid et repli svc-referentiel en échec`,
    );
    throw new ServiceUnavailableException(
      `barème PSU au ${date} indisponible : read model froid et repli svc-referentiel en échec`,
    );
  }

  /**
   * Sélectionne la valeur de la version applicable à `date` via le socle
   * versionné (lot 1) ; `undefined` si aucune version ne couvre la date.
   */
  private selectionner<T>(
    versions: readonly {
      valideDu: string;
      valideAu: string | null;
      valeur: T;
    }[],
    date: string,
  ): T | undefined {
    try {
      return selectionnerVersionApplicable(depuisBornes(versions), date).valeur;
    } catch (erreur) {
      if (erreur instanceof AucuneVersionApplicableError) {
        return undefined;
      }
      throw erreur;
    }
  }

  /**
   * Assemble les prestations du mois pour tous les contrats du foyer, à partir des
   * projections `prestation_mois` **déjà chargées**. Pour chaque contrat connu
   * (`contrats`), on prend la projection si présente ; si elle est **froide**
   * (absente pour ce mois/simulé), on bascule sur un **repli synchrone**
   * `svc-planification` (timeout/retry/CB) pour la reconstituer à la volée.
   * Un repli qui **échoue** (réseau/circuit ouvert) répond **503 explicite** :
   * omettre le contrat sous-estimerait silencieusement le total. Un repli qui
   * **réussit** avec zéro prestation (contrat sans prestation ce mois) reste une
   * omission légitime — comportement inchangé.
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
      if (!repli) {
        this.logger.error(
          `Prestations du contrat ${c.id} (${mois}) indisponibles : read model froid et repli svc-planification en échec`,
        );
        throw new ServiceUnavailableException(
          `prestations du contrat ${c.id} (${mois}) indisponibles : read model froid et repli svc-planification en échec`,
        );
      }
      const prestation = repli.prestations[0];
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
}
