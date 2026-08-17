import { Duree } from '@creche-planner/shared-kernel';
import {
  ContratCreche,
  type AbsenceCreche,
  type AjustementCreche,
  type JourSupplementaireCreche,
  type SaisieGenerationCreche,
} from './contrat-creche.js';
import {
  InscriptionAbcm,
  type ExceptionJour,
  type JourAlsh,
  type SaisieGenerationAlsh,
  type SaisieGenerationCantine,
  type SaisieGenerationPeriscolaire,
  type SemaineTypeAbcm,
  type TypeAlsh,
} from './inscription-abcm.js';
import { PlageHoraire } from './plage-horaire.js';
import { SemaineType, type SaisieSemaineType } from './semaine-type.js';
import type {
  PrestationMois,
  PrestationsMoisAlsh,
  PrestationsMoisCantine,
  PrestationsMoisCreche,
  PrestationsMoisPeriscolaire,
} from './prestations-mois.types.js';
import { ParametreContratInvalideError } from './planification-error.js';

/**
 * Génération des prestations du mois depuis la **forme brute persistée** d'un
 * contrat et de sa saisie mensuelle (colonnes JSON / DTO REST). Ce module fait
 * le pont « JSON stocké → objets du domaine → prestations » : il reconstruit la
 * semaine type, convertit les plages heures/minutes en `Duree` et aiguille vers
 * le générateur du mode. Domaine pur : aucune dépendance à la persistance.
 */

/** Plage horaire brute (heures/minutes d'arrivée et de départ), forme JSON. */
export interface PlageHeuresJson {
  readonly debutHeures: number;
  readonly debutMinutes: number;
  readonly finHeures: number;
  readonly finMinutes: number;
}

/** Forme JSON de la semaine type crèche stockée en base (jour → plages). */
export type SemaineTypeJson = Record<string, PlageHeuresJson[]>;

/** Absence crèche saisie : fenêtre horaire + éligibilité à déduction. */
export interface AbsenceCrecheJson extends PlageHeuresJson {
  readonly date?: string | undefined;
  readonly preavisJours: number;
  readonly certificatMaladie: boolean;
}

/** Jour de garde ajouté ponctuellement hors semaine type (crèche). */
export interface JourSupplementaireJson extends PlageHeuresJson {
  readonly date: string;
}

/**
 * Ajustement d'heures réelles d'un jour contractualisé (crèche) : la plage
 * heures/minutes est la **présence réelle** du jour ; le domaine en dérive
 * extension et réduction. `preavisJours`/`certificatMaladie` conditionnent la
 * déductibilité de la réduction (même règle que les absences).
 */
export interface AjustementJson extends PlageHeuresJson {
  readonly date: string;
  readonly preavisJours: number;
  readonly certificatMaladie: boolean;
}

/** Ajustement ponctuel d'un jour ABCM (surcharge la semaine type). */
export interface ExceptionJourJson {
  readonly date: string;
  readonly cantine?: boolean | undefined;
  readonly periMatin?: boolean | undefined;
  readonly periSoir?: boolean | undefined;
  readonly alsh?: boolean | undefined;
}

/** Un jour ALSH réservé. */
export interface JourAlshJson {
  readonly date: string;
  readonly type: TypeAlsh;
  readonly repas?: boolean | undefined;
}

/**
 * Saisie mensuelle brute d'un planning (paramètres dépendants du mode), telle
 * que persistée : complément/jours supplémentaires/absences pour la crèche,
 * PAI pour la cantine, exceptions pour l'ABCM, jours réservés pour l'ALSH.
 */
export interface SaisiePlanningJson {
  readonly complementMinutes?: number | undefined;
  readonly joursSupplementaires?: readonly JourSupplementaireJson[] | undefined;
  readonly absences?: readonly AbsenceCrecheJson[] | undefined;
  readonly ajustements?: readonly AjustementJson[] | undefined;
  readonly pai?: boolean | undefined;
  readonly exceptions?: readonly ExceptionJourJson[] | undefined;
  readonly joursAlsh?: readonly JourAlshJson[] | undefined;
}

/**
 * Sous-ensemble **pur** d'un contrat persisté, nécessaire à la génération :
 * mode, période de validité et configuration mode-spécifique brute. Les champs
 * mode-étrangers sont `null` (colonnes non renseignées pour l'autre famille).
 */
export interface ContratPourGeneration {
  readonly mode: string;
  readonly valideDu: string;
  readonly valideAu: string | null;
  readonly heuresAnnuellesContractualisees: number | null;
  readonly nbMensualites: number | null;
  readonly semaineType: SemaineTypeJson | null;
  readonly semaineAbcm: SemaineTypeAbcm | null;
}

/** Durée d'une plage (fin − début) ; `zero` si la plage est incohérente. */
export function dureeDePlage(p: PlageHeuresJson): Duree {
  const debut = p.debutHeures * 60 + p.debutMinutes;
  const fin = p.finHeures * 60 + p.finMinutes;
  return fin > debut ? Duree.depuisMinutes(fin - debut) : Duree.zero();
}

/** Reconstruit la `SemaineType` du domaine depuis sa forme JSON stockée. */
export function semaineTypeDepuisJson(json: SemaineTypeJson): SemaineType {
  const saisie: SaisieSemaineType = {};
  for (const [jour, plages] of Object.entries(json)) {
    (saisie as Record<string, PlageHoraire[]>)[jour] = plages.map((p) =>
      PlageHoraire.creer(
        p.debutHeures,
        p.debutMinutes,
        p.finHeures,
        p.finMinutes,
      ),
    );
  }
  return SemaineType.creer(saisie);
}

/**
 * Génère la prestation du mois d'un contrat : reconstruit l'objet du domaine
 * (`ContratCreche` / `InscriptionAbcm`) depuis la forme brute et aiguille vers
 * le générateur du mode. Tout mode inconnu de la famille ABCM est traité comme
 * de l'ALSH (aiguillage par élimination, comme les générateurs).
 */
export function genererPrestationMois(
  contrat: ContratPourGeneration,
  mois: string,
  saisie: SaisiePlanningJson,
  joursNonFacturables: readonly string[],
): PrestationMois {
  if (contrat.mode === 'CRECHE_PSU') {
    const contratCreche = ContratCreche.creer({
      valideDu: contrat.valideDu,
      // Colonne nullable = contrat **sans terme** ; le repli d'avant (`?? valideDu`)
      // en faisait une période d'un seul jour, donc un contrat muet dès le mois
      // suivant (`AM-13`). Spread conditionnel : `exactOptionalPropertyTypes`.
      ...(contrat.valideAu !== null ? { valideAu: contrat.valideAu } : {}),
      heuresAnnuellesContractualisees:
        contrat.heuresAnnuellesContractualisees ?? 0,
      nbMensualites: contrat.nbMensualites ?? 1,
      semaineType: semaineTypeDepuisJson(contrat.semaineType ?? {}),
    });
    const saisieCreche: SaisieGenerationCreche = {
      mois,
      complement:
        saisie.complementMinutes !== undefined
          ? Duree.depuisMinutes(saisie.complementMinutes)
          : Duree.zero(),
      joursSupplementaires: (saisie.joursSupplementaires ?? [])
        .map((j): JourSupplementaireCreche => ({
          date: j.date,
          duree: dureeDePlage(j),
        }))
        // Plage incohérente (fin ≤ début) → durée nulle, ignorée (sans complément).
        .filter((j) => !j.duree.estZero()),
      absences: (saisie.absences ?? []).map((a): AbsenceCreche => ({
        ...(a.date !== undefined ? { date: a.date } : {}),
        duree: dureeDePlage(a),
        preavisJours: a.preavisJours,
        certificatMaladie: a.certificatMaladie,
      })),
      ajustements: (saisie.ajustements ?? []).map((a): AjustementCreche => ({
        date: a.date,
        presence: PlageHoraire.creer(
          a.debutHeures,
          a.debutMinutes,
          a.finHeures,
          a.finMinutes,
        ),
        preavisJours: a.preavisJours,
        certificatMaladie: a.certificatMaladie,
      })),
      joursNonFacturables,
    };
    return contratCreche.genererPrestationsMois(saisieCreche);
  }

  const inscription = InscriptionAbcm.creer({
    semaine: contrat.semaineAbcm ?? {},
    valideDu: contrat.valideDu,
    ...(contrat.valideAu !== null ? { valideAu: contrat.valideAu } : {}),
  });
  const exceptions = (saisie.exceptions ?? []).map((e): ExceptionJour => ({
    date: e.date,
    ...(e.cantine !== undefined ? { cantine: e.cantine } : {}),
    ...(e.periMatin !== undefined ? { periMatin: e.periMatin } : {}),
    ...(e.periSoir !== undefined ? { periSoir: e.periSoir } : {}),
    ...(e.alsh !== undefined ? { alsh: e.alsh } : {}),
  }));
  if (contrat.mode === 'CANTINE') {
    const saisieCantine: SaisieGenerationCantine = {
      mois,
      pai: saisie.pai ?? false,
      exceptions,
      joursNonFacturables,
    };
    return inscription.genererPrestationsCantine(saisieCantine);
  }
  if (contrat.mode === 'PERISCOLAIRE') {
    const saisiePeri: SaisieGenerationPeriscolaire = {
      mois,
      exceptions,
      joursNonFacturables,
    };
    return inscription.genererPrestationsPeriscolaire(saisiePeri);
  }
  const saisieAlsh: SaisieGenerationAlsh = {
    mois,
    joursAlsh: (saisie.joursAlsh ?? []).map((j): JourAlsh => ({
      date: j.date,
      type: j.type,
      ...(j.repas !== undefined ? { repas: j.repas } : {}),
    })),
    exceptions,
    joursNonFacturables,
  };
  return inscription.genererPrestationsAlsh(saisieAlsh);
}

/**
 * Vrai si `date` (ISO `YYYY-MM-DD`) tombe dans la période effective d'un segment
 * (`valideDu`/`valideAu` déjà restreints par le service à la version × la vie du
 * contrat × le mois). `valideAu === null` = période ouverte (borne haute absente).
 */
function couvreDate(segment: ContratPourGeneration, date: string): boolean {
  return (
    date >= segment.valideDu &&
    (segment.valideAu === null || date <= segment.valideAu)
  );
}

/**
 * Répartit une saisie mensuelle entre les segments (versions) d'un mois. Les items
 * **datés** (jours supplémentaires, absences datées, ajustements, exceptions, jours
 * ALSH) vont au segment dont la période couvre leur date — à défaut, au segment
 * « mensuel » ; les scalaires **non datés** (complément, PAI, absences sans date)
 * relèvent des paramètres mensuels et vont au seul segment mensuel (H7) — jamais
 * comptés plusieurs fois.
 */
interface PartSaisie {
  complementMinutes?: number;
  joursSupplementaires: JourSupplementaireJson[];
  absences: AbsenceCrecheJson[];
  ajustements: AjustementJson[];
  pai?: boolean;
  exceptions: ExceptionJourJson[];
  joursAlsh: JourAlshJson[];
}

function repartirSaisie(
  segments: readonly ContratPourGeneration[],
  saisie: SaisiePlanningJson,
  idxMensuel: number,
): SaisiePlanningJson[] {
  const parts: PartSaisie[] = segments.map(() => ({
    joursSupplementaires: [],
    absences: [],
    ajustements: [],
    exceptions: [],
    joursAlsh: [],
  }));

  // `idxMensuel` est toujours un index valide (0..n-1) → cast sûr, sans branche.
  const partMensuel = parts[idxMensuel]!;

  /** Part du segment couvrant `date`, ou la part mensuelle à défaut (trou). */
  const cibleDe = (date: string): PartSaisie => {
    const idx = segments.findIndex((s) => couvreDate(s, date));
    return parts[idx] ?? partMensuel;
  };

  // Scalaires mensuels : rattachés au seul segment mensuel (jamais dupliqués).
  if (saisie.complementMinutes !== undefined) {
    partMensuel.complementMinutes = saisie.complementMinutes;
  }
  if (saisie.pai !== undefined) {
    partMensuel.pai = saisie.pai;
  }

  for (const j of saisie.joursSupplementaires ?? []) {
    cibleDe(j.date).joursSupplementaires.push(j);
  }
  for (const a of saisie.absences ?? []) {
    // Absence datée → segment couvrant sa date ; sans date → paramètre mensuel.
    (a.date !== undefined ? cibleDe(a.date) : partMensuel).absences.push(a);
  }
  for (const a of saisie.ajustements ?? []) {
    cibleDe(a.date).ajustements.push(a);
  }
  for (const e of saisie.exceptions ?? []) {
    cibleDe(e.date).exceptions.push(e);
  }
  for (const j of saisie.joursAlsh ?? []) {
    cibleDe(j.date).joursAlsh.push(j);
  }

  return parts.map((p) => ({
    ...(p.complementMinutes !== undefined
      ? { complementMinutes: p.complementMinutes }
      : {}),
    joursSupplementaires: p.joursSupplementaires,
    absences: p.absences,
    ajustements: p.ajustements,
    ...(p.pai !== undefined ? { pai: p.pai } : {}),
    exceptions: p.exceptions,
    joursAlsh: p.joursAlsh,
  }));
}

/** Fusionne des prestations crèche par segment (H7 : mensualité du segment du 1er). */
function fusionnerCreche(
  parts: readonly PrestationsMoisCreche[],
  mensuel: PrestationsMoisCreche,
): PrestationsMoisCreche {
  return {
    mode: 'CRECHE_PSU',
    // Mensualité (H7) : celle du segment couvrant le 1er du mois.
    heuresAnnuellesContractualisees: mensuel.heuresAnnuellesContractualisees,
    nbMensualites: mensuel.nbMensualites,
    heuresMensualisees: mensuel.heuresMensualisees,
    // Quantités journalières : sommées sur tous les segments.
    complement: parts.reduce((t, p) => t.plus(p.complement), Duree.zero()),
    heuresReservees: parts.reduce(
      (t, p) => t.plus(p.heuresReservees),
      Duree.zero(),
    ),
    heuresDeduites: parts.reduce(
      (t, p) => t.plus(p.heuresDeduites),
      Duree.zero(),
    ),
  };
}

/**
 * Génère la prestation d'un mois à partir d'une **suite de segments** (versions du
 * contrat couvrant le mois). Un seul segment = comportement historique inchangé ;
 * plusieurs = génération par segment (chacun restreint à sa période effective) puis
 * fusion des prestations. Les paramètres **journaliers** (semaine type/inscriptions)
 * se résolvent jour par jour via la période de chaque segment ; les paramètres
 * **mensuels** (mensualité crèche, PAI cantine) suivent le segment couvrant le 1er
 * du mois (H7). Tous les segments partagent le même `mode` (l'identité n'est pas
 * versionnée, H6).
 */
export function genererPrestationMoisSegments(
  segments: readonly ContratPourGeneration[],
  mois: string,
  saisie: SaisiePlanningJson,
  joursNonFacturables: readonly string[],
): PrestationMois {
  const [premier] = segments;
  if (premier === undefined) {
    throw new ParametreContratInvalideError(
      'au moins un segment de contrat attendu pour générer les prestations',
    );
  }
  if (segments.length === 1) {
    return genererPrestationMois(premier, mois, saisie, joursNonFacturables);
  }

  // Segment « mensuel » (H7) : celui couvrant le 1er du mois ; à défaut (contrat
  // débutant en cours de mois), le premier segment actif (segments triés par
  // date d'effet croissante côté service).
  const premierJour = `${mois}-01`;
  const trouve = segments.findIndex((s) => couvreDate(s, premierJour));
  const idxMensuel = trouve >= 0 ? trouve : 0;

  const saisieParSegment = repartirSaisie(segments, saisie, idxMensuel);
  // `saisieParSegment` a exactement une entrée par segment → indexation sûre.
  const prestations = segments.map((segment, i) =>
    genererPrestationMois(
      segment,
      mois,
      saisieParSegment[i]!,
      joursNonFacturables,
    ),
  );

  // `idxMensuel` ∈ [0, n) → indexation sûre par cast (aucune branche morte).
  const mode = premier.mode;
  if (mode === 'CRECHE_PSU') {
    const creche = prestations as PrestationsMoisCreche[];
    return fusionnerCreche(creche, creche[idxMensuel]!);
  }
  if (mode === 'CANTINE') {
    const cantine = prestations as PrestationsMoisCantine[];
    return {
      mode: 'CANTINE',
      nbJours: cantine.reduce((t, p) => t + p.nbJours, 0),
      // PAI : scalaire mensuel → porté par le segment mensuel.
      pai: cantine[idxMensuel]!.pai,
    };
  }
  if (mode === 'PERISCOLAIRE') {
    const peri = prestations as PrestationsMoisPeriscolaire[];
    return {
      mode: 'PERISCOLAIRE',
      nbMatins: peri.reduce((t, p) => t + p.nbMatins, 0),
      nbSoirs: peri.reduce((t, p) => t + p.nbSoirs, 0),
    };
  }
  const alsh = prestations as PrestationsMoisAlsh[];
  return {
    mode: 'ALSH',
    nbJourneesCompletes: alsh.reduce((t, p) => t + p.nbJourneesCompletes, 0),
    nbDemiJournees: alsh.reduce((t, p) => t + p.nbDemiJournees, 0),
    nbRepas: alsh.reduce((t, p) => t + p.nbRepas, 0),
  };
}
