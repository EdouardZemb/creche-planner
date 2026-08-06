import {
  Body,
  Controller,
  HttpCode,
  HttpStatus,
  Logger,
  Post,
} from '@nestjs/common';
import { z } from 'zod';
import { gatewayOpenApiDocument } from '@creche-planner/contracts-kernel';
import { valider } from '../bff/bff.dto.js';

/**
 * **Point de collecte des plantages client (lot C7, volet b).**
 *
 * Les six services backend sont sous OTel, journalisés dans Loki et couverts par
 * Prometheus/Alertmanager ; le navigateur était le seul endroit du système où une
 * panne ne produisait aucun signal. Cette route ferme ce point aveugle.
 *
 * **Même-origine, jamais un service tiers** : la CSP même-origine posée par A6
 * l'interdit déjà, et c'est bien ainsi (aucune donnée de famille ne sort). La
 * corrélation est gratuite : la requête POST porte son propre `trace_id`, injecté
 * dans la ligne de journal par l'instrumentation pino/OTel — c'est lui qu'on suit
 * dans Loki, et il relie le plantage au reste de l'activité de la gateway.
 *
 * La route n'est **pas** `@Public()` : elle suit la même auth machine que le reste
 * du BFF (le navigateur porte déjà le jeton) et reste soumise au `RateLimitGuard`
 * global — une boucle de rendu ne doit pas pouvoir inonder la gateway. Le client
 * plafonne déjà ses envois par chargement de page ; ceci est la seconde borne.
 */

/**
 * Origines acceptées, **DÉRIVÉES du contrat** (`components.schemas.ErreurClient`)
 * et non recopiées : le document est `as const`, l'indexation rend donc le tuple
 * littéral que `z.enum` attend. Côté web, le type du corps est dérivé du même
 * endroit via `openapi-types.gen.ts`.
 *
 * C'est la leçon des lots D4 et D6 appliquée d'emblée : une liste recopiée ici
 * aurait dû être inscrite au registre `MIROIRS` de `pnpm frontieres` pour être
 * gardée — une dérivation n'a rien à garder.
 */
const ORIGINES =
  gatewayOpenApiDocument.components.schemas.ErreurClient.properties.origine
    .enum;

/**
 * Corps du signalement. Bornes identiques côté web (qui tronque avant d'envoyer) :
 * elles existent ici pour que la gateway ne dépende pas de la bonne foi du client.
 */
export const erreurClientSchema = z.object({
  origine: z.enum(ORIGINES),
  message: z.string().min(1).max(500),
  route: z.string().min(1).max(300),
  pile: z.string().max(4000).optional(),
  composant: z.string().max(1000).optional(),
});
export type ErreurClient = z.infer<typeof erreurClientSchema>;

/**
 * Neutralise les sauts de ligne et caractères de contrôle d'une valeur venue du
 * navigateur avant de la journaliser. pino encode déjà la ligne en JSON, mais la
 * chaîne de journalisation ne se réduit pas à pino (Loki, `docker logs`, greps
 * d'exploitation) : un message forgé contenant un saut de ligne pourrait y
 * fabriquer une fausse entrée. C'est l'assainissement attendu contre l'injection
 * de journal — et il rend au passage chaque signalement tenable sur UNE ligne,
 * pile comprise.
 */
function assainir(valeur: string): string {
  let sortie = '';
  for (const caractere of valeur) {
    const code = caractere.codePointAt(0) ?? 0;
    // < 0x20 : sauts de ligne, retours chariot, tabulations… ; 0x7f : DEL.
    sortie += code < 0x20 || code === 0x7f ? ' ' : caractere;
  }
  return sortie.trim();
}

@Controller({ path: 'erreurs-client', version: '1' })
export class ErreursClientController {
  private readonly logger = new Logger('ErreurClient');

  /**
   * Journalise un plantage survenu dans le navigateur. **204 systématique** (hors
   * corps invalide) : le client n'a rien à faire du résultat, il est déjà en train
   * de récupérer d'un plantage.
   *
   * Le préfixe `PLANTAGE CLIENT` est l'ancre de recherche Loki (`{} |= "PLANTAGE
   * CLIENT"`) et le point d'accroche d'une future alerte — même convention que le
   * `SCOPE AURAIT REFUSÉ` de l'authz observe-only.
   */
  @Post()
  @HttpCode(HttpStatus.NO_CONTENT)
  signaler(@Body() corps: unknown): void {
    const erreur = valider(erreurClientSchema, corps);
    const details = [
      `origine=${erreur.origine}`,
      `route=${assainir(erreur.route)}`,
      `message=${assainir(erreur.message)}`,
      ...(erreur.composant === undefined
        ? []
        : [`composant=${assainir(erreur.composant)}`]),
    ].join(' ');

    this.logger.error(
      `PLANTAGE CLIENT ${details}`,
      erreur.pile === undefined ? undefined : assainir(erreur.pile),
    );
  }
}
