export { PeriodeValidite } from './lib/periode-validite.js';
export {
  type ModeGarde,
  MODES_GARDE,
  MODES_ABCM,
  estModeGarde,
  estModeAbcm,
  parseModeGarde,
} from './lib/mode-garde.js';
export { trancheDepuisNiveau } from './lib/tranche-ref.js';
export {
  type Versionne,
  selectionnerVersionApplicable,
  verifierAbsenceChevauchement,
} from './lib/catalogue-versionne.js';
export {
  PeriodeInvalideError,
  ModeGardeInconnuError,
  TrancheInconnueError,
  AucuneVersionApplicableError,
  VersionsChevauchantesError,
} from './lib/referentiel-error.js';
