// Cœur de calcul (port + agrégats)
export { LigneDeCout, CoutMois } from './lib/core/cout-mois.js';
export type { SensLigne } from './lib/core/cout-mois.js';
export type {
  ModeGarde,
  PolitiqueTarifaire,
} from './lib/core/politique-tarifaire.js';
export {
  QuantiteInvalideError,
  TauxEffortInconnuError,
  GrilleIndisponibleError,
  DeductionExcessiveError,
} from './lib/core/tarification-error.js';

// Crèche PSU
export {
  BaremeEffortPsu,
  BAREME_EFFORT_PSU_2026,
} from './lib/psu/bareme-effort-psu.js';
export { TarifCrechePsu } from './lib/psu/tarif-creche-psu.js';
export type {
  ConfigTarifCrechePsu,
  SaisieMoisPsu,
  AbsencePsu,
} from './lib/psu/tarif-creche-psu.js';

// ABCM
export { GrilleAbcm } from './lib/abcm/grille-abcm.js';
export { TarifCantineAbcm } from './lib/abcm/tarif-cantine-abcm.js';
export type { SaisieMoisCantine } from './lib/abcm/tarif-cantine-abcm.js';
export { TarifPeriscolaireAbcm } from './lib/abcm/tarif-periscolaire-abcm.js';
export type { SaisieMoisPeriscolaire } from './lib/abcm/tarif-periscolaire-abcm.js';
export { TarifAlshAbcm } from './lib/abcm/tarif-alsh-abcm.js';
export type { SaisieMoisAlsh } from './lib/abcm/tarif-alsh-abcm.js';
export { FraisFixesAbcm } from './lib/abcm/frais-fixes-abcm.js';
export type {
  ConfigFraisFixesAbcm,
  SaisieMoisFraisFixes,
} from './lib/abcm/frais-fixes-abcm.js';
export { UnitesAssociativesAbcm } from './lib/abcm/unites-associatives-abcm.js';
export type {
  ConfigUnitesAssociatives,
  SaisieUnitesAssociatives,
} from './lib/abcm/unites-associatives-abcm.js';

// Consolidation foyer
export { consoliderCoutMoisFoyer } from './lib/consolidation/cout-mois-foyer.js';
