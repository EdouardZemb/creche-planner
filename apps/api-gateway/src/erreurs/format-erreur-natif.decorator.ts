import { SetMetadata } from '@nestjs/common';

/** Clé de métadonnée exemptant une route du format `application/problem+json`. */
export const FORMAT_ERREUR_NATIF_KEY = 'gateway:format-erreur-natif';

/**
 * Exempte une route (ou un contrôleur entier) de la traduction en RFC 9457 :
 * son corps d'erreur part **tel que le framework l'a construit**.
 *
 * Une seule famille de routes en relève aujourd'hui, et pour une raison
 * contractuelle : `/api/health` et `/api/health/live` répondent **503 avec le
 * rapport de santé lui-même** (`HealthCheckResult`, nommant l'indicateur en
 * défaut). Ce corps est documenté comme tel dans l'OpenAPI, consommé par la
 * Porte 3 du déploiement et par le heartbeat ; le remplacer par un problème
 * ferait perdre le seul renseignement qui compte — *lequel* des cinq amonts est
 * tombé. La RFC ne demande pas d'écraser un format d'erreur qui **porte déjà de
 * la donnée** ; elle demande d'en finir avec ceux qui n'en portent pas.
 *
 * Toute exemption ajoutée ici doit s'accompagner de sa réponse documentée dans
 * `gatewayOpenApiDocument` : la porte `pnpm problemes` compare les deux listes.
 */
export const FormatErreurNatif = () =>
  SetMetadata(FORMAT_ERREUR_NATIF_KEY, true);
