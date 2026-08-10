export {
  CircuitBreaker,
  CircuitOuvertError,
  fetchAvecTimeout,
  executerResilient,
  executerOuRepli,
} from './lib/resilience.js';
export type { OptionsResilience, EtatCircuit } from './lib/resilience.js';
export {
  ErreurAmont,
  appelHttpResilient,
  appelHttpOuRepli,
  estErreurHttpRejouable,
  executerAppelHttp,
} from './lib/appel-http.js';
export type {
  MethodeHttp,
  FournisseurEntetes,
  ConfigAppelHttp,
  ConfigAppelHttpResilient,
} from './lib/appel-http.js';
