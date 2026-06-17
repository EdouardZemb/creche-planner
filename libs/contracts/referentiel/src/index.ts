// Contrats d'événements du bounded context **Référentiel** (`context:referentiel`,
// ADR-0004). Émis par `svc-referentiel`, consommés par `svc-tarification`.
// L'enveloppe partagée vit dans `@creche-planner/contracts-kernel`.
export * from './lib/events/referentiel-events.js';
