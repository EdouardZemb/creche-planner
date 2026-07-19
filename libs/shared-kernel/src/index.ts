export { Money } from './lib/money.js';
export { Duree } from './lib/duree.js';
export { Tranche } from './lib/tranche.js';
export { brander, type Brand } from './lib/branded.js';
export {
  DomainError,
  MontantNegatifError,
  MontantNonEntierError,
  DureeInvalideError,
  PlageHoraireInvalideError,
  PeriodeInvalideError,
  AucuneVersionApplicableError,
  ChevauchementVersionsError,
  TrouDansVersionsError,
} from './lib/domain-error.js';
export {
  PeriodeValidite,
  cloreVersionPrecedente,
  selectionnerVersionApplicable,
  verifierAbsenceChevauchement,
  verifierContinuite,
  depuisBornes,
  depuisSuite,
  type Versionne,
  type VersionValide,
} from './lib/versionnement.js';
