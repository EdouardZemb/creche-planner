// AQ-10 (doc 27) / DEC-03 (doc 09) — Génère les types TypeScript du client web
// depuis le contrat OpenAPI de la gateway.
//
// Source de vérité : `gatewayOpenApiDocument` (objet littéral `as const` dans
// contracts-kernel, servi par `GET /api/openapi.json`). La spec vivant en
// statique dans une lib, on l'importe directement — aucune gateway à démarrer.
// L'import d'un fichier .ts depuis ce .mjs repose sur le type-stripping natif
// de Node ≥ 23.6 (Node 24 dans .nvmrc) ; gateway.openapi.ts ne contient que de
// la syntaxe TS effaçable (objet littéral + `as const`), sans import.
//
// Sortie : `apps/web/src/api/openapi-types.gen.ts` (COMMITÉ). La génération est
// déterministe (openapi-typescript épinglé, pas d'horodatage) → la CI régénère
// et exige un diff vide (job `openapi-types-drift`, même motif qu'AQ-02).
//
// Usage : `pnpm nx run web:generate-types` (ou `node scripts/generate-openapi-types.mjs`).

import { writeFile } from 'node:fs/promises';
import openapiTS, { astToString } from 'openapi-typescript';
import { gatewayOpenApiDocument } from '../libs/contracts/kernel/src/lib/openapi/gateway.openapi.ts';

const SORTIE = new URL(
  '../apps/web/src/api/openapi-types.gen.ts',
  import.meta.url,
);

const entete = `// ⚠️ FICHIER GÉNÉRÉ — NE PAS ÉDITER À LA MAIN.
// Source : gatewayOpenApiDocument (libs/contracts/kernel/src/lib/openapi/gateway.openapi.ts).
// Régénérer : pnpm nx run web:generate-types (scripts/generate-openapi-types.mjs).
// Garde CI : job openapi-types-drift (régénération + diff vide exigé).

`;

const ast = await openapiTS(gatewayOpenApiDocument);
await writeFile(SORTIE, entete + astToString(ast), 'utf8');
console.log(`Types OpenAPI générés → ${SORTIE.pathname}`);
