import type {
  PlanningMensuel,
  PrestationMois,
  PrestationsMoisAlsh,
  PrestationsMoisCantine,
  PrestationsMoisCreche,
  PrestationsMoisPeriscolaire,
} from './prestations-mois.types.js';
import { MoisIncoherentError } from './planification-error.js';

export { MoisIncoherentError } from './planification-error.js';

/** Delta de quantités crèche entre un planning réel et un planning simulé. */
export interface DeltaCreche {
  readonly deltaHeuresReserveesMinutes: number;
  readonly deltaHeuresDeduitesMinutes: number;
  readonly deltaComplementMinutes: number;
}

/** Delta cantine (jours réservés). */
export interface DeltaCantine {
  readonly nbJours: number;
}

/** Delta périscolaire (séances). */
export interface DeltaPeriscolaire {
  readonly nbMatins: number;
  readonly nbSoirs: number;
}

/** Delta ALSH (journées/demi-journées/repas). */
export interface DeltaAlsh {
  readonly nbJourneesCompletes: number;
  readonly nbDemiJournees: number;
  readonly nbRepas: number;
}

/**
 * Différence de prestations entre un planning réel et un planning simulé, par
 * mode (mode simulation, doc 05 Phase 8). Les modes inchangés sont omis. Les
 * deltas sont des quantités signées (positif = ajout, négatif = retrait).
 */
export interface DeltaPlanning {
  readonly mois: string;
  readonly creche?: DeltaCreche;
  readonly cantine?: DeltaCantine;
  readonly periscolaire?: DeltaPeriscolaire;
  readonly alsh?: DeltaAlsh;
}

function trouver<M extends PrestationMois['mode']>(
  planning: PlanningMensuel,
  mode: M,
): Extract<PrestationMois, { mode: M }> | undefined {
  return planning.prestations.find((p) => p.mode === mode) as
    | Extract<PrestationMois, { mode: M }>
    | undefined;
}

function minutes(
  presta: PrestationsMoisCreche | undefined,
  champ: keyof Pick<
    PrestationsMoisCreche,
    'complement' | 'heuresReservees' | 'heuresDeduites'
  >,
): number {
  return presta === undefined ? 0 : presta[champ].enMinutes;
}

function deltaCreche(
  reel: PrestationsMoisCreche | undefined,
  simule: PrestationsMoisCreche | undefined,
): DeltaCreche | undefined {
  if (reel === undefined && simule === undefined) {
    return undefined;
  }
  const delta: DeltaCreche = {
    deltaHeuresReserveesMinutes:
      minutes(simule, 'heuresReservees') - minutes(reel, 'heuresReservees'),
    deltaHeuresDeduitesMinutes:
      minutes(simule, 'heuresDeduites') - minutes(reel, 'heuresDeduites'),
    deltaComplementMinutes:
      minutes(simule, 'complement') - minutes(reel, 'complement'),
  };
  if (
    delta.deltaHeuresReserveesMinutes === 0 &&
    delta.deltaHeuresDeduitesMinutes === 0 &&
    delta.deltaComplementMinutes === 0
  ) {
    return undefined;
  }
  return delta;
}

function deltaCantine(
  reel: PrestationsMoisCantine | undefined,
  simule: PrestationsMoisCantine | undefined,
): DeltaCantine | undefined {
  if (reel === undefined && simule === undefined) {
    return undefined;
  }
  const nbJours = (simule?.nbJours ?? 0) - (reel?.nbJours ?? 0);
  return nbJours === 0 ? undefined : { nbJours };
}

function deltaPeriscolaire(
  reel: PrestationsMoisPeriscolaire | undefined,
  simule: PrestationsMoisPeriscolaire | undefined,
): DeltaPeriscolaire | undefined {
  if (reel === undefined && simule === undefined) {
    return undefined;
  }
  const nbMatins = (simule?.nbMatins ?? 0) - (reel?.nbMatins ?? 0);
  const nbSoirs = (simule?.nbSoirs ?? 0) - (reel?.nbSoirs ?? 0);
  return nbMatins === 0 && nbSoirs === 0 ? undefined : { nbMatins, nbSoirs };
}

function deltaAlsh(
  reel: PrestationsMoisAlsh | undefined,
  simule: PrestationsMoisAlsh | undefined,
): DeltaAlsh | undefined {
  if (reel === undefined && simule === undefined) {
    return undefined;
  }
  const nbJourneesCompletes =
    (simule?.nbJourneesCompletes ?? 0) - (reel?.nbJourneesCompletes ?? 0);
  const nbDemiJournees =
    (simule?.nbDemiJournees ?? 0) - (reel?.nbDemiJournees ?? 0);
  const nbRepas = (simule?.nbRepas ?? 0) - (reel?.nbRepas ?? 0);
  return nbJourneesCompletes === 0 && nbDemiJournees === 0 && nbRepas === 0
    ? undefined
    : { nbJourneesCompletes, nbDemiJournees, nbRepas };
}

/**
 * Calcule la différence de prestations entre un planning réel et un planning
 * simulé pour un même mois (delta = simulé − réel). Les modes inchangés sont
 * omis du résultat. Lève `MoisIncoherentError` si les mois diffèrent.
 */
export function calculerDeltaPlanning(
  reel: PlanningMensuel,
  simule: PlanningMensuel,
): DeltaPlanning {
  if (reel.mois !== simule.mois) {
    throw new MoisIncoherentError(
      `mois incohérents : réel ${reel.mois} ≠ simulé ${simule.mois}`,
    );
  }
  const creche = deltaCreche(
    trouver(reel, 'CRECHE_PSU'),
    trouver(simule, 'CRECHE_PSU'),
  );
  const cantine = deltaCantine(
    trouver(reel, 'CANTINE'),
    trouver(simule, 'CANTINE'),
  );
  const periscolaire = deltaPeriscolaire(
    trouver(reel, 'PERISCOLAIRE'),
    trouver(simule, 'PERISCOLAIRE'),
  );
  const alsh = deltaAlsh(trouver(reel, 'ALSH'), trouver(simule, 'ALSH'));

  // Construction conditionnelle : `exactOptionalPropertyTypes` interdit
  // d'assigner `undefined` à une propriété optionnelle.
  return {
    mois: reel.mois,
    ...(creche !== undefined ? { creche } : {}),
    ...(cantine !== undefined ? { cantine } : {}),
    ...(periscolaire !== undefined ? { periscolaire } : {}),
    ...(alsh !== undefined ? { alsh } : {}),
  };
}
