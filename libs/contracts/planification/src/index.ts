// Contrats d'événements du bounded context **Planification** (`context:planification`,
// ADR-0004). Émis par `svc-planification`, consommés par `svc-tarification`.
// L'enveloppe partagée vit dans `@creche-planner/contracts-kernel`.
export * from './lib/events/planification-events.js';
export * from './lib/etablissement/preavis.js';
