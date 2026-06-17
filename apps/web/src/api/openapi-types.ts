// Accès ergonomique aux types HTTP GÉNÉRÉS depuis le document OpenAPI de la
// gateway (AQ-10 / DEC-03). La source de vérité est `gatewayOpenApiDocument`
// (contracts-kernel, servi par `GET /api/openapi.json`) ; les types sont
// produits par `openapi-typescript` dans `openapi-types.gen.ts` (commité,
// régénérable via `pnpm nx run web:generate-types`, garde CI
// `openapi-types-drift` : régénération + diff vide exigé).
//
// Ce fichier ne contient AUCUN type métier réécrit à la main : seulement des
// alias d'indexation dans `paths`/`components` du fichier généré, pour garder
// les points d'accès historiques (`SchemaComposant`, `ReponseJson`,
// `CorpsRequeteJson`) consommés par `types/bff.ts`.
//
// Historique : avant AQ-10, un interpréteur de JSON Schema au niveau type
// (fait main) dérivait ces types du littéral `as const` du contrat. Il ne
// couvrait qu'un sous-ensemble de JSON Schema (divergence silencieuse en
// `unknown` hors de ce sous-ensemble) — remplacé par le codegen outillé.

import type { components, paths } from './openapi-types.gen';

type Schemas = components['schemas'];

/** Type d'un schéma réutilisable de `components.schemas` (ex. `SchemaComposant<'FoyerVue'>`). */
export type SchemaComposant<Name extends keyof Schemas> = Schemas[Name];

/**
 * Réponse JSON typée d'une route du contrat gateway
 * (ex. `ReponseJson<'/api/v1/couts', 'get', 200>`). Statut en NOMBRE :
 * openapi-typescript génère des clés numériques pour `responses`.
 */
export type ReponseJson<
  Path extends keyof paths,
  Method extends keyof paths[Path],
  Status extends number,
> = paths[Path][Method] extends { responses: infer R }
  ? Status extends keyof R
    ? R[Status] extends { content: { 'application/json': infer J } }
      ? J
      : never
    : never
  : never;

/** Corps de requête JSON typé d'une route POST/PUT du contrat gateway. */
export type CorpsRequeteJson<
  Path extends keyof paths,
  Method extends keyof paths[Path],
> = paths[Path][Method] extends {
  requestBody: { content: { 'application/json': infer J } };
}
  ? J
  : never;
