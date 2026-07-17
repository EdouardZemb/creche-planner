import { Injectable, Logger } from '@nestjs/common';
import { z } from 'zod';
import { entetesAssertionMachine } from '@creche-planner/nest-commons';
import { loadConfig } from '../config.js';

/** Forme d'un jour non facturable renvoyé par le Référentiel. */
const jourNonFacturableSchema = z.object({
  jour: z.string(),
  type: z.string(),
  libelle: z.string(),
});
const reponseSchema = z.array(jourNonFacturableSchema);

/**
 * Client du service Référentiel. Récupère les **jours non facturables**
 * (fériés/fermetures/vacances, INV-04) pour exclure ces jours de la génération
 * des prestations. L'appel `fetch` est auto-instrumenté (OpenTelemetry/undici) :
 * le `traceparent` est propagé. Si le Référentiel est injoignable, on dégrade
 * proprement (aucune exclusion) plutôt que d'échouer la lecture des prestations.
 */
@Injectable()
export class ReferentielClient {
  private readonly logger = new Logger(ReferentielClient.name);

  /** Dates ISO `YYYY-MM-DD` non facturables (toutes périodes confondues). */
  async joursNonFacturables(): Promise<string[]> {
    const config = loadConfig();
    const url = `${config.referentielUrl}/api/calendrier/jours-non-facturables`;
    try {
      // Assertion machine inter-services (fondations lot 3).
      const reponse = await fetch(url, {
        headers: entetesAssertionMachine(
          'svc-planification',
          config.assertion.secret,
        ),
      });
      if (!reponse.ok) {
        throw new Error(`HTTP ${reponse.status}`);
      }
      const corps: unknown = await reponse.json();
      return reponseSchema.parse(corps).map((j) => j.jour);
    } catch (erreur) {
      this.logger.warn(
        `Référentiel injoignable (${url} : ${(erreur as Error).message}) — ` +
          `aucun jour non facturable exclu`,
      );
      return [];
    }
  }
}
