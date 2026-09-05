// Calendrier / jours
export type { JourSemaine } from './lib/jour-semaine.js';
export { jourSemaineDeIso } from './lib/jour-semaine.js';
export { joursDuMois } from './lib/mois.js';

// Calendrier d'ouverture versionné (SFD 31 — 3 couches + axe de connaissance)
export {
  estConnuA,
  SERVICES_CALENDRIER,
  ancreDeConnaissance,
  clore,
  resoudreJour,
  resoudreMois,
  verifierUniciteOuverte,
} from './lib/calendrier-ouverture.js';
export type {
  CalendrierOuverture,
  Connaissance,
  ContexteJour,
  ExceptionCalendrier,
  JourResolu,
  PeriodeCalendrier,
  RecurrenceCalendrier,
  RegimeSemaine,
  ServiceCalendrier,
  TypeException,
  TypePeriode,
} from './lib/calendrier-ouverture.js';

// Semaine type & plages horaires (crèche)
export { PlageHoraire } from './lib/plage-horaire.js';
export { SemaineType } from './lib/semaine-type.js';
export type { SaisieSemaineType } from './lib/semaine-type.js';

// Contrat crèche PSU → prestations du mois
export { ContratCreche } from './lib/contrat-creche.js';
export type {
  ConfigContratCreche,
  SaisieGenerationCreche,
  AbsenceCreche,
  AjustementCreche,
  JourSupplementaireCreche,
} from './lib/contrat-creche.js';

// Inscription ABCM (cantine / périscolaire / ALSH) → prestations du mois
export { InscriptionAbcm } from './lib/inscription-abcm.js';
export type {
  ConfigInscriptionAbcm,
  SemaineTypeAbcm,
  InscriptionsJour,
  ExceptionJour,
  TypeAlsh,
  JourAlsh,
  SaisieGenerationCantine,
  SaisieGenerationPeriscolaire,
  SaisieGenerationAlsh,
} from './lib/inscription-abcm.js';

// Génération depuis la forme brute persistée (JSON contrat + saisie mensuelle)
export {
  dureeDePlage,
  genererPrestationMois,
  genererPrestationMoisSegments,
  semaineTypeDepuisJson,
} from './lib/generation-prestations.js';
export type {
  AbsenceCrecheJson,
  AjustementJson,
  ContratPourGeneration,
  ExceptionJourJson,
  JourAlshJson,
  JourSupplementaireJson,
  PlageHeuresJson,
  SaisiePlanningJson,
  SemaineTypeJson,
} from './lib/generation-prestations.js';

// « Prestations du mois » (forme exposée à l'app et à la tarification)
export type {
  PlanningMensuel,
  PrestationMois,
  PrestationsMoisCreche,
  PrestationsMoisCantine,
  PrestationsMoisPeriscolaire,
  PrestationsMoisAlsh,
} from './lib/prestations-mois.types.js';

// Planning simulé (delta)
export { calculerDeltaPlanning } from './lib/planning-simule.js';
export type {
  DeltaPlanning,
  DeltaCreche,
  DeltaCantine,
  DeltaPeriscolaire,
  DeltaAlsh,
} from './lib/planning-simule.js';

// Erreurs typées
export {
  DateInvalideError,
  MoisInvalideError,
  PeriodeContratInvalideError,
  ParametreContratInvalideError,
  DeductionExcessiveError,
  AjustementJourNonGardeError,
  SaisieJourEnConflitError,
  MoisIncoherentError,
  ConnaissanceInvalideError,
  CalendrierIncoherentError,
} from './lib/planification-error.js';
