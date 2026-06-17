// Contrats d'événements du bounded context **Foyer** (`context:foyer`, ADR-0004).
// Émis par `svc-foyer`, consommés par `svc-tarification`. L'enveloppe partagée
// vit dans `@creche-planner/contracts-kernel`.
export * from './lib/events/foyer-events.js';
