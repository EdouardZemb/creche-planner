import { Injectable, Logger } from '@nestjs/common';
import { z } from 'zod';
import { entetesAssertionMachine } from '@creche-planner/nest-commons';
import {
  appelHttpOuRepli,
  CircuitBreaker,
  type OptionsResilience,
} from '@creche-planner/resilience';
import { loadConfig } from '../config.js';

/** Forme d'un jour non facturable renvoyé par le Référentiel. */
const jourNonFacturableSchema = z.object({
  jour: z.string(),
  type: z.string(),
  libelle: z.string(),
});
/**
 * Seules les dates intéressent l'appelant : le schéma déplie la réponse pour que
 * la valeur nominale et la valeur de repli (`[]`) aient le même type.
 */
const reponseSchema = z
  .array(jourNonFacturableSchema)
  .transform((jours) => jours.map((j) => j.jour));

const OPTIONS: OptionsResilience = {
  timeoutMs: 2000,
  retries: 1,
  delaiEntreEssaisMs: 200,
};

/**
 * Client du service Référentiel. Récupère les **jours non facturables**
 * (fériés/fermetures/vacances, INV-04) pour exclure ces jours de la génération
 * des prestations. L'appel `fetch` est auto-instrumenté (OpenTelemetry/undici) :
 * le `traceparent` est propagé. Si le Référentiel est injoignable, on dégrade
 * proprement (aucune exclusion) plutôt que d'échouer la lecture des prestations.
 *
 * Passé sous la plomberie partagée au lot D1 : l'appel était le dernier `fetch`
 * **brut** du monorepo, donc le seul non borné — il pouvait retenir une lecture
 * de prestations aussi longtemps que le Référentiel restait muet. Il hérite
 * désormais du timeout, du retry borné et du disjoncteur communs ; la
 * dégradation en liste vide, elle, est inchangée.
 */
@Injectable()
export class ReferentielClient {
  private readonly logger = new Logger(ReferentielClient.name);
  private readonly breaker = new CircuitBreaker();

  /** Assertion machine inter-services (fondations lot 3), injectée dans l'appel. */
  private readonly entetes = (): Record<string, string> =>
    entetesAssertionMachine('svc-planification', loadConfig().assertion.secret);

  /** Dates ISO `YYYY-MM-DD` non facturables (toutes périodes confondues). */
  async joursNonFacturables(): Promise<string[]> {
    return appelHttpOuRepli(
      {
        service: 'svc-referentiel',
        logger: this.logger,
        breaker: this.breaker,
        options: OPTIONS,
        entetes: this.entetes,
        methode: 'GET',
        url: `${loadConfig().referentielUrl}/api/calendrier/jours-non-facturables`,
        schema: reponseSchema,
      },
      [],
    );
  }
}
