// DTO validés par Zod aux frontières HTTP (doc 03 §3).
// Phase 1 : uniquement le contrat /health. Les DTO métier (foyer, grilles,
// prestations, coûts…) seront ajoutés par leur contexte dans les phases suivantes.
export * from './health.js';
