// Kernel de contrat partagé (`context:shared`, ADR-0004).
// Contient UNIQUEMENT les contrats réellement transverses : l'enveloppe
// `IntegrationEvent` (transport stable), les DTO transverses (santé) et le
// document OpenAPI de la gateway. Les événements métier sont décentralisés
// dans `@creche-planner/contracts-<contexte>`.
export * from './lib/events/index.js';
export * from './lib/dto/index.js';
export * from './lib/openapi/gateway.openapi.js';
