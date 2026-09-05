import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  and,
  asc,
  eq,
  gt,
  gte,
  inArray,
  isNull,
  lte,
  or,
  type SQL,
} from 'drizzle-orm';
import type { AnyPgColumn } from 'drizzle-orm/pg-core';
import {
  estConnuA,
  joursDuMois,
  resoudreJour,
  resoudreMois,
  type CalendrierOuverture,
  type ExceptionCalendrier,
  type JourResolu,
  type PeriodeCalendrier,
  type RecurrenceCalendrier,
  type ServiceCalendrier,
} from '@creche-planner/planification-domain';
import {
  ajouterJours,
  differenceEnJours,
  instant,
  type Instant,
  type RegimeFeries,
} from '@creche-planner/shared-kernel';
import { CLOCK, DRIZZLE, type Clock } from '@creche-planner/nest-commons';
import type { Database } from '../database/database.types.js';
import {
  calendrierException,
  calendrierPeriode,
  calendrierRecurrence,
  calendrierRegimeFeries,
  etablissement,
  type CalendrierExceptionRow,
  type CalendrierPeriodeRow,
  type CalendrierRecurrenceRow,
} from '../database/schema.js';
import type {
  PoserExceptionDto,
  RemplacerRecurrencesDto,
  SaisirPeriodeDto,
} from './calendrier.dto.js';

/** Transaction Drizzle (le `tx` passé au callback de `db.transaction`). */
type Tx = Parameters<Parameters<Database['transaction']>[0]>[0];

/**
 * Régime de fériés par défaut (D7) : le national. Un établissement sans aucune
 * ligne de régime connue à l'instant demandé — cas d'un `aLaDate` antérieur à sa
 * création — est donc lu `FR`, exactement le comportement d'avant ce chantier.
 */
const REGIME_PAR_DEFAUT: RegimeFeries = 'FR';

/**
 * Largeur maximale d'une lecture, en jours. Une année pleine (+ un jour bissextile,
 * + un jour parce que les bornes sont inclusives) couvre le besoin réel — un écran
 * de calendrier lit un mois, la génération lit un mois. La borne existe pour qu'un
 * `?du=1970-01-01&au=2999-12-31` soit un 400 plutôt qu'un balayage.
 */
const LARGEUR_MAX_JOURS = 366;

/** Un jour résolu, tel que rendu par l'API. */
export type JourResoluVue = JourResolu;

/**
 * Réponse de la lecture résolue. **Cette forme est le contrat gelé du chantier**
 * (plan §Lot 2) : le plan 33 la consommera par client REST inter-services **sans
 * pact** — un consommateur silencieux, qu'un changement de forme casserait sans
 * qu'aucune porte ne sonne.
 *
 * L'enveloppe n'est pas décorative. Elle **réverbère les trois paramètres de la
 * question** — dont `aLaDate`, y compris (surtout) quand l'appelant l'a omis :
 * c'est ce qui rend le défaut « maintenant » observable au lieu d'implicite, et ce
 * qui permet à un appelant de journaliser l'instant de connaissance réellement
 * employé. Un tableau nu aurait aussi interdit tout ajout ultérieur de champ.
 */
export interface CalendrierResoluVue {
  readonly du: string;
  readonly au: string;
  readonly aLaDate: string;
  readonly jours: readonly JourResoluVue[];
}

/** Une récurrence telle que rendue par l'API (avec son ouverture de connaissance). */
export interface RecurrenceVue {
  readonly id: string;
  readonly regime: 'SCOLAIRE' | 'VACANCES';
  readonly jourSemaine: string;
  readonly services: readonly ServiceCalendrier[];
  readonly connuDepuis: string;
}

/** Une période telle que rendue par l'API. */
export interface PeriodeVue {
  readonly id: string;
  readonly type: 'PERIODE_SCOLAIRE' | 'VACANCES' | 'FERMETURE_ANNUELLE';
  readonly libelle: string;
  readonly du: string;
  readonly au: string;
  readonly source: 'IMPORT' | 'MANUEL';
  readonly anneeScolaire: string | null;
  readonly connuDepuis: string;
}

/** Une exception telle que rendue par l'API (`services: null` = tous). */
export interface ExceptionVue {
  readonly id: string;
  readonly jour: string;
  readonly type: 'FERMETURE' | 'OUVERTURE' | 'JOURNEE_PEDAGOGIQUE' | 'PONT';
  readonly libelle: string;
  readonly services: readonly ServiceCalendrier[] | null;
  readonly connuDepuis: string;
}

/**
 * # Le calendrier d'ouverture, persistant
 *
 * Ce service **mappe**, il ne calcule pas : toute la règle (priorité des couches,
 * fériés, spécificité des périodes qui se chevauchent, réduction à l'instant de
 * connaissance) vit dans `calendrier-ouverture.ts` — domaine pur, arrêté au lot 1
 * et testé exhaustivement. Ce qui vit ici, et nulle part ailleurs :
 *
 * 1. **L'append-only.** Aucune méthode d'écriture ne fait d'`UPDATE` sur une
 *    donnée ni de `DELETE`. Retoucher, c'est poser `connu_jusqua` sur la ligne en
 *    vigueur (`clore`, côté SQL) et insérer la nouvelle **au même instant**, dans
 *    la **même transaction** — sans quoi il existerait un intervalle, si bref
 *    soit-il, où la couche n'a aucune ligne ouverte, et une lecture concurrente y
 *    lirait un calendrier troué. « Supprimer » est donc une **clôture**.
 * 2. **La lecture de l'horloge.** Le domaine ne sait pas quel jour on est ; c'est
 *    ici qu'on le lui dit, via `CLOCK` (injectable, donc poussable en test).
 * 3. **Le filtrage SQL de l'axe métier — et de lui seul.** On restreint la requête
 *    aux lignes dont la plage `du`/`au` (ou le `jour`) touche la fenêtre demandée.
 *    On ne filtre **jamais** sur `connu_jusqua` : les lignes closes sont
 *    précisément ce dont le domaine a besoin pour répondre à un `aLaDate` passé.
 *    Confondre les deux rendrait l'historique invisible tout en gardant l'API
 *    verte — le mode de défaillance que ce chantier existe pour interdire.
 */
@Injectable()
export class CalendrierService {
  constructor(
    @Inject(DRIZZLE) private readonly db: Database,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {}

  /** L'instant courant, en `Instant` brandé. */
  private maintenant(): Instant {
    return instant(this.clock.maintenant().toISOString());
  }

  /** `aLaDate` fourni par l'appelant, ou « maintenant » à défaut (contrat gelé). */
  private ancre(aLaDate: string | undefined): Instant {
    return aLaDate === undefined ? this.maintenant() : instant(aLaDate);
  }

  /**
   * Traduit une violation d'unicité Postgres (`23505`) en **409**.
   *
   * Les unicités du calendrier sont **partielles** (`WHERE connu_jusqua IS NULL`)
   * et deux écritures concurrentes peuvent les heurter : deux onglets qui posent
   * une exception le même jour, ou une semaine type envoyée deux fois. Sans cette
   * traduction, le parent voit un 500 pour un conflit parfaitement ordinaire — et
   * le CRUD établissement, lui, rend déjà 409 sur la même famille d'erreur.
   */
  private async enConflit<T>(operation: () => Promise<T>): Promise<T> {
    try {
      return await operation();
    } catch (erreur) {
      if (
        typeof erreur === 'object' &&
        erreur !== null &&
        (erreur as { code?: unknown }).code === '23505'
      ) {
        throw new ConflictException(
          'le calendrier a été modifié en même temps : recharger puis réessayer',
        );
      }
      throw erreur;
    }
  }

  /**
   * La ligne rendue par un `INSERT … RETURNING`. Postgres en rend toujours une
   * (aucune de ces insertions n'a de clause de conflit) ; on le **vérifie** au
   * lieu de l'affirmer par un `!` — une assertion non-nulle transformerait une
   * anomalie de driver en `TypeError` illisible trois couches plus haut.
   */
  private ligneInseree<T>(
    lignes: readonly (T | undefined)[],
    table: string,
  ): T {
    const ligne = lignes[0];
    if (ligne === undefined) {
      throw new Error(`insertion sans ligne rendue : ${table}`);
    }
    return ligne;
  }

  /** 404 si l'établissement n'existe pas — avant toute écriture. */
  private async garantirEtablissement(etablissementId: string): Promise<void> {
    const [ligne] = await this.db
      .select({ id: etablissement.id })
      .from(etablissement)
      .where(eq(etablissement.id, etablissementId))
      .limit(1);
    if (ligne === undefined) {
      throw new NotFoundException(
        `établissement introuvable : ${etablissementId}`,
      );
    }
  }

  // ── Lecture résolue ─────────────────────────────────────────────────────────

  /**
   * Résout chaque jour de `[du, au]` (bornes **inclusives**, axe métier) tel qu'il
   * était connu à `aLaDate` (axe de connaissance).
   */
  async lireResolu(
    etablissementId: string,
    du: string,
    au: string,
    aLaDate?: string,
  ): Promise<CalendrierResoluVue> {
    if (du > au) {
      throw new BadRequestException(
        `plage invalide : « au » (${au}) précède « du » (${du})`,
      );
    }
    const largeur = differenceEnJours(du, au) + 1;
    if (largeur > LARGEUR_MAX_JOURS) {
      throw new BadRequestException(
        `plage trop large : ${String(largeur)} jours demandés, ` +
          `${String(LARGEUR_MAX_JOURS)} au maximum`,
      );
    }
    await this.garantirEtablissement(etablissementId);
    const ancre = this.ancre(aLaDate);
    const calendrier = await this.chargerCalendrier(
      etablissementId,
      du,
      au,
      ancre,
    );
    const jours: JourResolu[] = [];
    for (let jour = du; jour <= au; jour = ajouterJours(jour, 1)) {
      jours.push(resoudreJour(calendrier, jour, ancre));
    }
    return { du, au, aLaDate: ancre, jours };
  }

  /**
   * Jours d'un mois `YYYY-MM` où `service` **n'est pas ouvert** — la liste que la
   * génération des prestations attend sous le nom `joursNonFacturables`
   * (RM-31-04, lot 4).
   *
   * **Le filtre est par SERVICE, jamais par jour entier.** C'est la règle qui
   * distingue cette liste de celle qu'elle remplace : l'ancienne venait du
   * Référentiel, était **globale**, et fermait donc l'ALSH les jours où la crèche
   * était fermée — alors que l'ALSH est précisément le service ouvert quand
   * l'école ferme. Un mercredi de vacances ferme cantine et périscolaire, pas
   * l'ALSH.
   *
   * `aLaDate` est **obligatoire** ici, sans valeur par défaut : c'est l'axe de
   * connaissance de RM-31-03, et un défaut « maintenant » suffirait à recalculer
   * un mois déjà facturé avec le calendrier d'aujourd'hui — exactement ce que
   * l'amendement PO du 2026-08-16 interdit. L'appelant l'obtient par
   * `ancreDeConnaissance`, jamais d'une horloge lue ici.
   */
  async joursFermesPourService(
    etablissementId: string,
    mois: string,
    service: ServiceCalendrier,
    aLaDate: Instant,
  ): Promise<string[]> {
    const jours = joursDuMois(mois);
    const premier = jours[0];
    const dernier = jours.at(-1);
    // `joursDuMois` lève sur un mois invalide ; la garde protège le typage, pas
    // un cas atteignable.
    if (premier === undefined || dernier === undefined) {
      return [];
    }
    const calendrier = await this.chargerCalendrier(
      etablissementId,
      premier,
      dernier,
      aLaDate,
    );

    // ─────────────────────────────────────────────────────────────────────────
    // **Calendrier INCONNU ≠ établissement FERMÉ.** La garde qui évite de mettre
    // toutes les factures à zéro le jour du déploiement.
    //
    // La couche 3 est la seule qui ouvre quoi que ce soit : sans récurrence, la
    // résolution rend `servicesOuverts: []` pour **chaque** jour du mois. Un
    // établissement dont personne n'a encore saisi la semaine type verrait donc
    // ses 30 jours déclarés non facturables — soit un mois entièrement vidé, en
    // silence, et pour tous les contrats à la fois.
    //
    // Or c'est exactement l'état de la production au moment où ce lot arrive :
    // l'écran de saisie du calendrier existe depuis le lot 3, et **aucun
    // établissement réel n'a encore de récurrence**. Fermer par défaut serait
    // lire une absence de donnée comme une donnée.
    //
    // Règle retenue, et elle est étroite : **aucune récurrence connue à cette
    // ancre ⇒ aucune exclusion**, soit rigoureusement le comportement d'avant ce
    // lot. Dès qu'une seule récurrence existe, le calendrier fait autorité, y
    // compris pour fermer. La règle ne peut donc pas masquer une fermeture
    // saisie : elle ne s'applique qu'au calendrier vide.
    // ─────────────────────────────────────────────────────────────────────────
    const recurrencesConnues = calendrier.recurrences.filter((ligne) =>
      estConnuA(ligne, aLaDate),
    );
    if (recurrencesConnues.length === 0) {
      return [];
    }

    return resoudreMois(calendrier, mois, aLaDate)
      .filter((jour) => !jour.servicesOuverts.includes(service))
      .map((jour) => jour.jour);
  }

  /**
   * Charge les trois couches **plus** le régime de fériés connu à `ancre`, sous la
   * forme que le domaine attend.
   *
   * Le régime est le seul élément résolu *ici* plutôt que par le domaine :
   * `CalendrierOuverture.regimeFeries` est un scalaire, pas une couche historisée
   * (le domaine reçoit un régime déjà tranché). L'axe de connaissance est donc
   * appliqué en SQL sur `calendrier_regime_feries` — même sémantique semi-ouverte
   * `[connu_depuis, connu_jusqua)` que partout ailleurs (`AM-106`).
   */
  private async chargerCalendrier(
    etablissementId: string,
    du: string,
    au: string,
    ancre: Instant,
  ): Promise<CalendrierOuverture> {
    const [periodes, exceptions, recurrences, regimeFeries] = await Promise.all(
      [
        this.db
          .select()
          .from(calendrierPeriode)
          .where(
            and(
              eq(calendrierPeriode.etablissementId, etablissementId),
              // Chevauchement de l'axe MÉTIER uniquement (bornes inclusives).
              lte(calendrierPeriode.du, au),
              gte(calendrierPeriode.au, du),
            ),
          ),
        this.db
          .select()
          .from(calendrierException)
          .where(
            and(
              eq(calendrierException.etablissementId, etablissementId),
              gte(calendrierException.jour, du),
              lte(calendrierException.jour, au),
            ),
          ),
        this.db
          .select()
          .from(calendrierRecurrence)
          .where(eq(calendrierRecurrence.etablissementId, etablissementId)),
        this.regimeFeriesA(etablissementId, ancre),
      ],
    );
    return {
      regimeFeries,
      periodes: periodes.map((p) => this.versPeriodeDomaine(p)),
      exceptions: exceptions.map((e) => this.versExceptionDomaine(e)),
      recurrences: recurrences.map((r) => this.versRecurrenceDomaine(r)),
    };
  }

  /**
   * Régime de fériés **connu à `ancre`** : la ligne dont l'intervalle de
   * connaissance contient l'instant, ou `FR` si aucune (D7).
   */
  private async regimeFeriesA(
    etablissementId: string,
    ancre: Instant,
  ): Promise<RegimeFeries> {
    const borne = new Date(ancre);
    const [ligne] = await this.db
      .select({ regime: calendrierRegimeFeries.regime })
      .from(calendrierRegimeFeries)
      .where(
        and(
          eq(calendrierRegimeFeries.etablissementId, etablissementId),
          lte(calendrierRegimeFeries.connuDepuis, borne),
          // Borne haute EXCLUSIVE : `connu_jusqua > ancre`, jamais `>=`.
          or(
            isNull(calendrierRegimeFeries.connuJusqua),
            gt(calendrierRegimeFeries.connuJusqua, borne),
          ),
        ),
      )
      .limit(1);
    return ligne?.regime ?? REGIME_PAR_DEFAUT;
  }

  /**
   * Régimes **actuellement** connus d'un lot d'établissements — la valeur que le
   * CRUD établissement expose. Lit les lignes ouvertes (`connu_jusqua IS NULL`),
   * servies par l'index partiel unique, en **un** aller-retour pour tout le lot :
   * la liste des établissements d'un foyer ne doit pas dégénérer en N requêtes.
   */
  async regimesFeriesOuverts(
    etablissementIds: readonly string[],
  ): Promise<Map<string, RegimeFeries>> {
    if (etablissementIds.length === 0) {
      return new Map();
    }
    const lignes = await this.db
      .select({
        etablissementId: calendrierRegimeFeries.etablissementId,
        regime: calendrierRegimeFeries.regime,
      })
      .from(calendrierRegimeFeries)
      .where(
        and(
          inArray(calendrierRegimeFeries.etablissementId, [
            ...etablissementIds,
          ]),
          isNull(calendrierRegimeFeries.connuJusqua),
        ),
      );
    return new Map(lignes.map((l) => [l.etablissementId, l.regime]));
  }

  // ── Couches brutes (lecture) ────────────────────────────────────────────────

  /** Récurrences **ouvertes à `aLaDate`**, triées pour un rendu stable. */
  async lireRecurrences(
    etablissementId: string,
    aLaDate?: string,
  ): Promise<{ aLaDate: string; recurrences: RecurrenceVue[] }> {
    await this.garantirEtablissement(etablissementId);
    const ancre = this.ancre(aLaDate);
    const lignes = await this.db
      .select()
      .from(calendrierRecurrence)
      .where(
        and(
          eq(calendrierRecurrence.etablissementId, etablissementId),
          this.connuA(calendrierRecurrence, ancre),
        ),
      )
      .orderBy(
        asc(calendrierRecurrence.regime),
        asc(calendrierRecurrence.jourSemaine),
      );
    return {
      aLaDate: ancre,
      recurrences: lignes.map((l) => ({
        id: l.id,
        regime: l.regime,
        jourSemaine: l.jourSemaine,
        services: l.services,
        connuDepuis: l.connuDepuis.toISOString(),
      })),
    };
  }

  /** Périodes **ouvertes à `aLaDate`**, triées par début. */
  async lirePeriodes(
    etablissementId: string,
    aLaDate?: string,
  ): Promise<{ aLaDate: string; periodes: PeriodeVue[] }> {
    await this.garantirEtablissement(etablissementId);
    const ancre = this.ancre(aLaDate);
    const lignes = await this.db
      .select()
      .from(calendrierPeriode)
      .where(
        and(
          eq(calendrierPeriode.etablissementId, etablissementId),
          this.connuA(calendrierPeriode, ancre),
        ),
      )
      .orderBy(asc(calendrierPeriode.du), asc(calendrierPeriode.libelle));
    return {
      aLaDate: ancre,
      periodes: lignes.map((l) => ({
        id: l.id,
        type: l.type,
        libelle: l.libelle,
        du: l.du,
        au: l.au,
        source: l.source,
        anneeScolaire: l.anneeScolaire,
        connuDepuis: l.connuDepuis.toISOString(),
      })),
    };
  }

  /** Exceptions **ouvertes à `aLaDate`**, triées par jour. */
  async lireExceptions(
    etablissementId: string,
    aLaDate?: string,
  ): Promise<{ aLaDate: string; exceptions: ExceptionVue[] }> {
    await this.garantirEtablissement(etablissementId);
    const ancre = this.ancre(aLaDate);
    const lignes = await this.db
      .select()
      .from(calendrierException)
      .where(
        and(
          eq(calendrierException.etablissementId, etablissementId),
          this.connuA(calendrierException, ancre),
        ),
      )
      .orderBy(asc(calendrierException.jour));
    return {
      aLaDate: ancre,
      exceptions: lignes.map((l) => ({
        id: l.id,
        jour: l.jour,
        type: l.type,
        libelle: l.libelle,
        services: l.services,
        connuDepuis: l.connuDepuis.toISOString(),
      })),
    };
  }

  /**
   * Prédicat « ligne connue à cet instant » : `connu_depuis <= ancre <
   * connu_jusqua`. La borne haute est **exclusive** — c'est ce qui fait qu'une
   * clôture et l'ouverture qui la suit, posées au même instant, désignent
   * exactement une ligne et jamais deux.
   */
  /**
   * ⚠️ **Comparateurs typés (`lte`/`gt`), jamais un fragment brut.** Interpoler une
   * valeur dans un gabarit SQL la place en paramètre **sans** le type de la
   * colonne : `postgres` reçoit alors un `Date` qu'il ne sait pas encoder et la
   * requête meurt en 500 (« Received an instance of Date »). Le défaut ne se voit
   * ni au typecheck ni au test unitaire — un faux `db` n'exécute aucune requête —
   * seulement contre une vraie base (`LE-88`, trouvé par la vérification pact
   * provider en CI ; une sonde de spec l'interdit désormais en source).
   */
  private connuA(
    table: { connuDepuis: AnyPgColumn; connuJusqua: AnyPgColumn },
    ancre: Instant,
  ): SQL | undefined {
    const borne = new Date(ancre);
    return and(
      lte(table.connuDepuis, borne),
      or(isNull(table.connuJusqua), gt(table.connuJusqua, borne)),
    );
  }

  // ── Écritures append-only ───────────────────────────────────────────────────

  /**
   * Remplace la récurrence hebdomadaire d'un bloc : clôt toutes les lignes
   * ouvertes et ouvre les nouvelles **au même instant**, dans une transaction.
   */
  async remplacerRecurrences(
    etablissementId: string,
    dto: RemplacerRecurrencesDto,
  ): Promise<{ aLaDate: string; recurrences: RecurrenceVue[] }> {
    await this.garantirEtablissement(etablissementId);
    const t = this.maintenant();
    const borne = new Date(t);
    await this.enConflit(() =>
      this.db.transaction(async (tx: Tx) => {
        await tx
          .update(calendrierRecurrence)
          .set({ connuJusqua: borne })
          .where(
            and(
              eq(calendrierRecurrence.etablissementId, etablissementId),
              isNull(calendrierRecurrence.connuJusqua),
            ),
          );
        if (dto.recurrences.length > 0) {
          await tx.insert(calendrierRecurrence).values(
            dto.recurrences.map((r) => ({
              etablissementId,
              regime: r.regime,
              jourSemaine: r.jourSemaine,
              services: r.services,
              connuDepuis: borne,
            })),
          );
        }
      }),
    );
    return this.lireRecurrences(etablissementId, t);
  }

  /**
   * Pose une exception sur un jour. **Upsert par jour** : s'il en existe déjà une
   * d'ouverte ce jour-là, elle est close et la nouvelle ouverte au même instant —
   * l'ancienne reste lisible. C'est la contrainte partielle
   * `calendrier_exception_jour_ouvert_uq` qui rend cette invariance structurelle,
   * pas seulement conventionnelle.
   */
  async poserException(
    etablissementId: string,
    dto: PoserExceptionDto,
  ): Promise<ExceptionVue> {
    await this.garantirEtablissement(etablissementId);
    const borne = new Date(this.maintenant());
    const ligne = await this.enConflit(() =>
      this.db.transaction(async (tx: Tx) => {
        await tx
          .update(calendrierException)
          .set({ connuJusqua: borne })
          .where(
            and(
              eq(calendrierException.etablissementId, etablissementId),
              eq(calendrierException.jour, dto.jour),
              isNull(calendrierException.connuJusqua),
            ),
          );
        const [inseree] = await tx
          .insert(calendrierException)
          .values({
            etablissementId,
            jour: dto.jour,
            type: dto.type,
            libelle: dto.libelle,
            services: dto.services === undefined ? null : [...dto.services],
            connuDepuis: borne,
          })
          .returning();
        return inseree;
      }),
    );
    return this.versExceptionVue(
      this.ligneInseree([ligne], 'calendrier_exception'),
    );
  }

  /** Clôt l'exception `id` (jamais de `DELETE`). 404 si inconnue ou déjà close. */
  async cloreException(etablissementId: string, id: string): Promise<void> {
    const closes = await this.db
      .update(calendrierException)
      .set({ connuJusqua: new Date(this.maintenant()) })
      .where(
        and(
          eq(calendrierException.id, id),
          eq(calendrierException.etablissementId, etablissementId),
          isNull(calendrierException.connuJusqua),
        ),
      )
      .returning({ id: calendrierException.id });
    if (closes.length === 0) {
      throw new NotFoundException(
        `exception introuvable ou déjà close : ${id}`,
      );
    }
  }

  /** Ouvre une période saisie manuellement. */
  async saisirPeriode(
    etablissementId: string,
    dto: SaisirPeriodeDto,
  ): Promise<PeriodeVue> {
    await this.garantirEtablissement(etablissementId);
    const lignes = await this.db
      .insert(calendrierPeriode)
      .values({
        etablissementId,
        type: dto.type,
        libelle: dto.libelle,
        du: dto.du,
        au: dto.au,
        source: 'MANUEL',
        anneeScolaire: dto.anneeScolaire ?? null,
        connuDepuis: new Date(this.maintenant()),
      })
      .returning();
    return this.versPeriodeVue(this.ligneInseree(lignes, 'calendrier_periode'));
  }

  /**
   * Retouche une période : clôt la ligne visée et en ouvre une nouvelle avec les
   * valeurs fournies, au même instant. La ligne d'origine reste lisible — c'est
   * elle que rendra une lecture à un `aLaDate` antérieur.
   */
  async retoucherPeriode(
    etablissementId: string,
    id: string,
    dto: SaisirPeriodeDto,
  ): Promise<PeriodeVue> {
    const borne = new Date(this.maintenant());
    const ligne = await this.db.transaction(async (tx: Tx) => {
      const closes = await tx
        .update(calendrierPeriode)
        .set({ connuJusqua: borne })
        .where(
          and(
            eq(calendrierPeriode.id, id),
            eq(calendrierPeriode.etablissementId, etablissementId),
            isNull(calendrierPeriode.connuJusqua),
          ),
        )
        .returning({ source: calendrierPeriode.source });
      const close = closes[0];
      if (close === undefined) {
        throw new NotFoundException(
          `période introuvable ou déjà close : ${id}`,
        );
      }
      const [inseree] = await tx
        .insert(calendrierPeriode)
        .values({
          etablissementId,
          type: dto.type,
          libelle: dto.libelle,
          du: dto.du,
          au: dto.au,
          // La retouche d'une période importée reste une saisie du parent : elle
          // devient `MANUEL`, donc protégée du prochain réimport (CA2, lot 3).
          source: 'MANUEL',
          anneeScolaire: dto.anneeScolaire ?? null,
          connuDepuis: borne,
        })
        .returning();
      return inseree;
    });
    return this.versPeriodeVue(
      this.ligneInseree([ligne], 'calendrier_periode'),
    );
  }

  /** Clôt la période `id` (jamais de `DELETE`). 404 si inconnue ou déjà close. */
  async clorePeriode(etablissementId: string, id: string): Promise<void> {
    const closes = await this.db
      .update(calendrierPeriode)
      .set({ connuJusqua: new Date(this.maintenant()) })
      .where(
        and(
          eq(calendrierPeriode.id, id),
          eq(calendrierPeriode.etablissementId, etablissementId),
          isNull(calendrierPeriode.connuJusqua),
        ),
      )
      .returning({ id: calendrierPeriode.id });
    if (closes.length === 0) {
      throw new NotFoundException(`période introuvable ou déjà close : ${id}`);
    }
  }

  // ── Régime de fériés (écrit par le CRUD établissement) ──────────────────────

  /**
   * Pose le régime de fériés d'un établissement sur l'axe de connaissance
   * (`AM-106`) : clôt la ligne ouverte et en ouvre une nouvelle **au même
   * instant**, dans la transaction fournie. Poser le régime déjà en vigueur est un
   * **no-op** — un `PUT` idempotent ne doit pas hacher l'historique en tranches
   * sans différence.
   *
   * Prend un `tx` : la création d'un établissement pose son régime **dans la même
   * transaction** que la ligne `etablissement` et son événement d'outbox. Un
   * établissement sans ligne de régime serait lisible (D7 le ramène à `FR`), mais
   * sa création aurait alors deux vérités possibles selon l'instant du crash.
   */
  async poserRegimeFeries(
    tx: Tx,
    etablissementId: string,
    regime: RegimeFeries,
  ): Promise<void> {
    const borne = new Date(this.maintenant());
    const [ouverte] = await tx
      .select({ regime: calendrierRegimeFeries.regime })
      .from(calendrierRegimeFeries)
      .where(
        and(
          eq(calendrierRegimeFeries.etablissementId, etablissementId),
          isNull(calendrierRegimeFeries.connuJusqua),
        ),
      )
      .limit(1);
    if (ouverte?.regime === regime) {
      return;
    }
    await tx
      .update(calendrierRegimeFeries)
      .set({ connuJusqua: borne })
      .where(
        and(
          eq(calendrierRegimeFeries.etablissementId, etablissementId),
          isNull(calendrierRegimeFeries.connuJusqua),
        ),
      );
    await tx.insert(calendrierRegimeFeries).values({
      etablissementId,
      regime,
      connuDepuis: borne,
    });
  }

  // ── Mappage lignes ↔ domaine / vues ─────────────────────────────────────────

  private versPeriodeDomaine(ligne: CalendrierPeriodeRow): PeriodeCalendrier {
    return {
      type: ligne.type,
      libelle: ligne.libelle,
      du: ligne.du,
      au: ligne.au,
      connuDepuis: instant(ligne.connuDepuis.toISOString()),
      ...(ligne.connuJusqua === null
        ? {}
        : { connuJusqua: instant(ligne.connuJusqua.toISOString()) }),
    };
  }

  private versExceptionDomaine(
    ligne: CalendrierExceptionRow,
  ): ExceptionCalendrier {
    return {
      jour: ligne.jour,
      type: ligne.type,
      libelle: ligne.libelle,
      // `null` en base = « tous les services » côté domaine, où l'absence de clé
      // porte ce sens. Une liste vide, elle, veut dire « aucun » : les deux ne se
      // confondent pas, et c'est pourquoi la colonne est nullable plutôt que
      // `default '[]'`.
      ...(ligne.services === null ? {} : { services: ligne.services }),
      connuDepuis: instant(ligne.connuDepuis.toISOString()),
      ...(ligne.connuJusqua === null
        ? {}
        : { connuJusqua: instant(ligne.connuJusqua.toISOString()) }),
    };
  }

  private versRecurrenceDomaine(
    ligne: CalendrierRecurrenceRow,
  ): RecurrenceCalendrier {
    return {
      regime: ligne.regime,
      jourSemaine: ligne.jourSemaine,
      services: ligne.services,
      connuDepuis: instant(ligne.connuDepuis.toISOString()),
      ...(ligne.connuJusqua === null
        ? {}
        : { connuJusqua: instant(ligne.connuJusqua.toISOString()) }),
    };
  }

  private versPeriodeVue(ligne: CalendrierPeriodeRow): PeriodeVue {
    return {
      id: ligne.id,
      type: ligne.type,
      libelle: ligne.libelle,
      du: ligne.du,
      au: ligne.au,
      source: ligne.source,
      anneeScolaire: ligne.anneeScolaire,
      connuDepuis: ligne.connuDepuis.toISOString(),
    };
  }

  private versExceptionVue(ligne: CalendrierExceptionRow): ExceptionVue {
    return {
      id: ligne.id,
      jour: ligne.jour,
      type: ligne.type,
      libelle: ligne.libelle,
      services: ligne.services,
      connuDepuis: ligne.connuDepuis.toISOString(),
    };
  }
}
