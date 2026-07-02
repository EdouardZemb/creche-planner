import { Duree } from '@creche-planner/shared-kernel';
import {
  ContratCreche,
  type AbsenceCreche,
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
import type { PrestationMois } from './prestations-mois.types.js';

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

/** Ajustement ponctuel d'un jour ABCM (surcharge la semaine type). */
export interface ExceptionJourJson {
  readonly date: string;
  readonly cantine?: boolean | undefined;
  readonly periMatin?: boolean | undefined;
  readonly periSoir?: boolean | undefined;
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
      valideAu: contrat.valideAu ?? contrat.valideDu,
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
        .map(
          (j): JourSupplementaireCreche => ({
            date: j.date,
            duree: dureeDePlage(j),
          }),
        )
        // Plage incohérente (fin ≤ début) → durée nulle, ignorée (sans complément).
        .filter((j) => !j.duree.estZero()),
      absences: (saisie.absences ?? []).map(
        (a): AbsenceCreche => ({
          ...(a.date !== undefined ? { date: a.date } : {}),
          duree: dureeDePlage(a),
          preavisJours: a.preavisJours,
          certificatMaladie: a.certificatMaladie,
        }),
      ),
      joursNonFacturables,
    };
    return contratCreche.genererPrestationsMois(saisieCreche);
  }

  const inscription = InscriptionAbcm.creer({
    semaine: contrat.semaineAbcm ?? {},
    valideDu: contrat.valideDu,
    ...(contrat.valideAu !== null ? { valideAu: contrat.valideAu } : {}),
  });
  const exceptions = (saisie.exceptions ?? []).map(
    (e): ExceptionJour => ({
      date: e.date,
      ...(e.cantine !== undefined ? { cantine: e.cantine } : {}),
      ...(e.periMatin !== undefined ? { periMatin: e.periMatin } : {}),
      ...(e.periSoir !== undefined ? { periSoir: e.periSoir } : {}),
    }),
  );
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
    joursAlsh: (saisie.joursAlsh ?? []).map(
      (j): JourAlsh => ({
        date: j.date,
        type: j.type,
        ...(j.repas !== undefined ? { repas: j.repas } : {}),
      }),
    ),
    joursNonFacturables,
  };
  return inscription.genererPrestationsAlsh(saisieAlsh);
}
