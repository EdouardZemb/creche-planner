// Sous-chemin **léger** (crypto pure `node:crypto`) : évite d'attirer le barrel
// nest-commons (DB/NATS/mailer) dans le bundle du BFF — la gateway n'a pas de base.
import {
  ENTETE_ASSERTION,
  signerAssertion,
} from '@creche-planner/nest-commons/security';
import { loadConfig } from '../config.js';
import { contexteAssertionCourant } from '../security/contexte-assertion.js';

/**
 * En-têtes d'**assertion d'identité** à injecter dans chaque appel sortant de la
 * gateway (chantier fondations lot 3). Un seul point de vérité, à étaler dans
 * `init.headers` de tous les clients (`...entetesAval()`).
 *
 * - Secret absent (`ASSERTION_IDENTITE_SECRET` non posé) → `{}` : aucun en-tête, les
 *   services restent en mode legacy.
 * - Contexte parent présent dans l'ALS (handler d'une requête identifiée) → assertion
 *   **parent** `{ email, foyers?, admin? }`.
 * - Sinon — appels hors requête **et** appels de résolution faits par les guards
 *   eux-mêmes (`FoyerClient.foyersParEmail`, `PlanificationClient.contrat()`, qui
 *   s'exécutent AVANT l'interceptor donc hors scope ALS) → assertion **machine**
 *   `{ machine: 'api-gateway' }`.
 *
 * Signature à chaque appel (pas de cache — coût négligeable, fraîcheur du `exp`).
 */
export function entetesAval(): Record<string, string> {
  const secret = loadConfig().assertionSecret;
  if (secret === undefined) {
    return {};
  }
  const contexte = contexteAssertionCourant();
  const jeton =
    contexte !== undefined
      ? signerAssertion(
          {
            email: contexte.email,
            foyers: contexte.foyers,
            admin: contexte.admin,
          },
          secret,
        )
      : signerAssertion({ machine: 'api-gateway' }, secret);
  return { [ENTETE_ASSERTION]: jeton };
}
