import {
  Inject,
  Injectable,
  UnprocessableEntityException,
} from '@nestjs/common';
import { and, eq, isNull } from 'drizzle-orm';
import { jourCourantParis } from '@creche-planner/shared-semaine';
import { CLOCK, DRIZZLE, type Clock } from '@creche-planner/nest-commons';
import type { Database } from '../database/database.types.js';
import { calendrierPeriode, etablissement } from '../database/schema.js';

/** Transaction Drizzle, dérivée du client plutôt que redéclarée. */
type Tx = Parameters<Parameters<Database['transaction']>[0]>[0];

/**
 * **Import du calendrier scolaire officiel** — SFD 31, US-31-01, lot 3.
 *
 * Le parent choisit une année scolaire ; on va chercher les périodes de vacances
 * de la zone de son établissement dans l'open data de l'Éducation nationale, et
 * on les matérialise en `calendrier_periode` (`source = 'IMPORT'`). Le §3 de la
 * SFD impose la matérialisation : aucune lecture de calendrier ne doit dépendre,
 * à l'exécution, d'une API tierce.
 *
 * ## Ce que ce service NE fait pas
 *
 * Il n'écrase rien de ce que le parent a saisi. C'est l'exigence CA2, et elle est
 * tenue **par construction** plutôt que par précaution : le réimport ne touche
 * que les lignes `source = 'IMPORT'` de l'année visée. Les périodes `MANUEL` et
 * toutes les exceptions (couche 1) ne sont pas dans le périmètre de l'écriture —
 * il n'y a donc pas de règle à ne pas oublier.
 *
 * ## Pourquoi une CLÔTURE et non un `DELETE`
 *
 * Le plan d'exécution disait « `delete … where source='IMPORT'` puis insert ».
 * C'est incompatible avec ce que le lot 2 a construit : `calendrier_periode` est
 * **append-only**, borné par `[connu_depuis, connu_jusqua)`, et « supprimer » y
 * est une **clôture**. Un `DELETE` rendrait faux tout `aLaDate` antérieur au
 * réimport, alors que RM-31-03 existe précisément pour qu'une retouche
 * d'aujourd'hui ne réécrive pas un mois déjà facturé — et l'export de
 * portabilité promet l'historique du calendrier, « son passé compris ».
 *
 * Le réimport clôt donc les lignes importées ouvertes et en ouvre de nouvelles
 * **au même instant**, dans une seule transaction. L'idempotence demandée est
 * conservée (rejouer l'import ne cumule rien), l'historique aussi.
 */
@Injectable()
export class CalendrierImportService {
  constructor(
    @Inject(DRIZZLE) private readonly db: Database,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {}

  async importerAnnee(
    etablissementId: string,
    anneeScolaire: string,
  ): Promise<ResultatImport> {
    const zone = await this.zoneDe(etablissementId);
    const enregistrements = await this.lireOpenData(zone, anneeScolaire);
    const periodes = mapperPeriodes(enregistrements, zone, anneeScolaire);

    if (periodes.length === 0) {
      throw new ImportSansPeriodeException(zone, anneeScolaire);
    }

    const borne = new Date(this.clock.maintenant().toISOString());
    return this.db.transaction(async (tx: Tx) => {
      const closes = await tx
        .update(calendrierPeriode)
        .set({ connuJusqua: borne })
        .where(
          and(
            eq(calendrierPeriode.etablissementId, etablissementId),
            eq(calendrierPeriode.source, 'IMPORT'),
            eq(calendrierPeriode.anneeScolaire, anneeScolaire),
            isNull(calendrierPeriode.connuJusqua),
          ),
        )
        .returning({ id: calendrierPeriode.id });

      const inserees = await tx
        .insert(calendrierPeriode)
        .values(
          periodes.map((p) => ({
            etablissementId,
            type: 'VACANCES' as const,
            libelle: p.libelle,
            du: p.du,
            au: p.au,
            source: 'IMPORT' as const,
            anneeScolaire,
            importeLe: borne,
            connuDepuis: borne,
          })),
        )
        .returning({ id: calendrierPeriode.id });

      return {
        anneeScolaire,
        zoneScolaire: zone,
        importees: inserees.length,
        remplacees: closes.length,
      };
    });
  }

  /**
   * Zone de l'établissement. Sans zone, l'import n'a pas de sens : on refuse en
   * **422 avec un code**, pas en 400 générique — l'écran doit pouvoir dire « posez
   * d'abord la zone » plutôt que « requête invalide », et c'est exactement la
   * distinction que le registre de codes existe pour porter.
   */
  private async zoneDe(etablissementId: string): Promise<ZoneScolaire> {
    const [ligne] = await this.db
      .select({ zone: etablissement.zoneScolaire })
      .from(etablissement)
      .where(eq(etablissement.id, etablissementId))
      .limit(1);

    if (ligne === undefined) {
      throw new ZoneScolaireAbsenteException(etablissementId);
    }
    if (ligne.zone === null || ligne.zone === undefined) {
      throw new ZoneScolaireAbsenteException(etablissementId);
    }
    return ligne.zone;
  }

  /**
   * Appel sortant vers data.education.gouv.fr.
   *
   * ⚠️ **Première dépendance sortante d'un service métier vers Internet** de ce
   * dépôt. Deux conséquences assumées ici : un `timeout` explicite (sans lui, un
   * amont muet tiendrait la requête du parent jusqu'au timeout du proxy), et un
   * diagnostic qui distingue « je n'ai pas pu joindre » de « on m'a répondu
   * autre chose » — sans quoi l'exploitation ne saurait pas si le pare-feu du
   * conteneur bloque l'egress ou si l'API a changé de forme.
   */
  private async lireOpenData(
    zone: ZoneScolaire,
    anneeScolaire: string,
  ): Promise<readonly EnregistrementOds[]> {
    const url = urlOpenData(zone, anneeScolaire);
    let reponse: Response;
    try {
      reponse = await fetch(url, {
        signal: AbortSignal.timeout(DELAI_MS),
        headers: { accept: 'application/json' },
      });
    } catch (cause) {
      throw new ImportIndisponibleException(
        `calendrier scolaire injoignable (${describeCause(cause)}) — ` +
          'vérifier que le service peut sortir en HTTPS vers data.education.gouv.fr',
        cause,
      );
    }
    if (!reponse.ok) {
      throw new ImportIndisponibleException(
        `calendrier scolaire indisponible : l'open data a répondu ${reponse.status}`,
      );
    }
    let corps: unknown;
    try {
      corps = await reponse.json();
    } catch (cause) {
      throw new ImportIndisponibleException(
        'réponse illisible de l’open data du calendrier scolaire',
        cause,
      );
    }
    const resultats = (corps as { results?: unknown })?.results;
    if (!Array.isArray(resultats)) {
      throw new ImportIndisponibleException(
        'réponse inattendue de l’open data : aucun tableau `results`',
      );
    }
    return resultats as readonly EnregistrementOds[];
  }
}

// ────────────────────────────────────────────────────────────── mapping (pur)

/** Zone de vacances telle que la porte l'établissement. */
export type ZoneScolaire = 'A' | 'B' | 'C';

/** Enregistrement brut du jeu `fr-en-calendrier-scolaire`. */
export interface EnregistrementOds {
  readonly description?: unknown;
  readonly start_date?: unknown;
  readonly end_date?: unknown;
  readonly zones?: unknown;
  readonly population?: unknown;
  readonly annee_scolaire?: unknown;
}

/** Période prête à insérer, bornes **incluses**, en dates locales. */
export interface PeriodeImportee {
  readonly libelle: string;
  readonly du: string;
  readonly au: string;
}

/** Ce que l'appel rend à l'écran. */
export interface ResultatImport {
  readonly anneeScolaire: string;
  readonly zoneScolaire: ZoneScolaire;
  /** Périodes posées par cet import. */
  readonly importees: number;
  /** Périodes importées précédemment, closes par celui-ci. */
  readonly remplacees: number;
}

const DELAI_MS = 8_000;

/** Base du jeu de données, sans secret ni clé d'API (jeu public). */
const BASE_ODS =
  'https://data.education.gouv.fr/api/explore/v2.1/catalog/datasets/fr-en-calendrier-scolaire/records';

/**
 * URL de l'appel. Le filtre `zones` est posé **côté serveur** parce que le jeu
 * couvre toute la France : sans lui on téléchargerait douze zones pour en garder
 * une. Le filtre `population` est refait côté client (voir `mapperPeriodes`) —
 * le jeu publie des lignes « Enseignants » en double, et le seul filtre serveur
 * ne suffit pas à s'en prémunir si le champ change de valeur.
 */
export function urlOpenData(zone: ZoneScolaire, anneeScolaire: string): string {
  const parametres = new URLSearchParams({
    where: `zones="Zone ${zone}" and annee_scolaire="${anneeScolaire}"`,
    limit: '100',
    order_by: 'start_date',
  });
  return `${BASE_ODS}?${parametres.toString()}`;
}

/**
 * Traduit les enregistrements bruts en périodes du domaine.
 *
 * **Deux conventions, toutes deux verrouillées par la fixture commitée :**
 *
 * 1. *Fuseau.* Les bornes sont des datetimes UTC qui valent minuit à Paris
 *    (`2026-10-16T22:00:00+00:00` = le 17 octobre à 00:00 CEST). Les lire en UTC
 *    donnerait le 16 : un jour de vacances de moins, tous les ans, sans que rien
 *    ne le signale.
 * 2. *Sémantique.* `start_date` est le premier jour de vacances (les vacances
 *    commencent le soir du dernier jour de classe) ; `end_date` est le jour de
 *    **reprise**, exclu. La borne `au` du domaine étant **incluse**, elle vaut la
 *    veille de la reprise.
 */
export function mapperPeriodes(
  enregistrements: readonly EnregistrementOds[],
  zone: ZoneScolaire,
  anneeScolaire: string,
): readonly PeriodeImportee[] {
  const vues = new Set<string>();
  const periodes: PeriodeImportee[] = [];

  for (const brut of enregistrements) {
    if (brut.zones !== `Zone ${zone}`) continue;
    if (brut.annee_scolaire !== anneeScolaire) continue;
    // Le jeu double chaque période avec une ligne « Enseignants » dont les dates
    // diffèrent parfois d'un jour (prérentrée). Elles ne concernent pas l'enfant.
    if (brut.population === 'Enseignants') continue;
    if (
      typeof brut.description !== 'string' ||
      typeof brut.start_date !== 'string' ||
      typeof brut.end_date !== 'string'
    ) {
      continue;
    }

    const du = jourParis(brut.start_date);
    const reprise = jourParis(brut.end_date);
    if (du === null || reprise === null) continue;
    const au = veille(reprise);
    if (au < du) continue;

    // Deux lignes identiques (populations « - » et « Élèves ») ne doivent pas
    // produire deux périodes : la clé est le triplet métier, pas la ligne source.
    const cle = `${brut.description}|${du}|${au}`;
    if (vues.has(cle)) continue;
    vues.add(cle);

    periodes.push({ libelle: brut.description, du, au });
  }

  return periodes;
}

/** Date calendaire Europe/Paris d'un instant ISO, ou `null` s'il est illisible. */
function jourParis(iso: string): string | null {
  const instant = new Date(iso);
  if (Number.isNaN(instant.getTime())) return null;
  return jourCourantParis(instant);
}

/** Veille d'une date `YYYY-MM-DD`, en arithmétique de calendrier (pas de fuseau). */
function veille(jour: string): string {
  const veille = new Date(`${jour}T12:00:00Z`);
  veille.setUTCDate(veille.getUTCDate() - 1);
  return veille.toISOString().slice(0, 10);
}

function describeCause(cause: unknown): string {
  if (cause instanceof Error) {
    return cause.name === 'TimeoutError' ? `délai de ${DELAI_MS} ms dépassé` : cause.message;
  }
  return 'cause inconnue';
}

// ───────────────────────────────────────────────────────────────── exceptions

/** 422 — l'établissement n'a pas de zone : il n'y a rien à importer. */
export class ZoneScolaireAbsenteException extends UnprocessableEntityException {
  constructor(etablissementId: string) {
    super({
      statusCode: 422,
      // Litteral volontaire : la porte `pnpm problemes` confronte ce code au
      // registre CODES_PROBLEME sans qu'il faille une arete Nx de plus.
      code: 'ZONE_SCOLAIRE_ABSENTE',
      message:
        `aucune zone de vacances scolaires n’est renseignée pour l’établissement ${etablissementId} : ` +
        'choisissez la zone (A, B ou C) avant d’importer une année',
    });
  }
}

/** 422 — l'open data a répondu, mais l'année demandée n'y a aucune période. */
export class ImportSansPeriodeException extends UnprocessableEntityException {
  constructor(zone: ZoneScolaire, anneeScolaire: string) {
    super({
      statusCode: 422,
      code: 'IMPORT_CALENDRIER_INDISPONIBLE',
      message:
        `l’open data ne publie aucune période pour la zone ${zone} en ${anneeScolaire} : ` +
        'cette année n’est peut-être pas encore parue',
    });
  }
}

/**
 * 422 — l'open data n'a pas pu être lu.
 *
 * 422 et non 502 : du point de vue du parent, l'écran reste **utilisable** (il
 * saisit à la main, CA3) et l'action a échoué pour une raison qu'on sait nommer.
 * Un 5xx ferait sonner les alertes d'exploitation pour une indisponibilité qui
 * n'est pas la nôtre. Le diagnostic ops, lui, part dans le message.
 */
export class ImportIndisponibleException extends UnprocessableEntityException {
  constructor(message: string, causeSousJacente?: unknown) {
    super({
      statusCode: 422,
      code: 'IMPORT_CALENDRIER_INDISPONIBLE',
      message,
    });
    // `cause` est standard sur Error : on la renseigne plutot que d'ajouter un
    // champ maison que personne ne lirait.
    if (causeSousJacente !== undefined) this.cause = causeSousJacente;
  }
}
