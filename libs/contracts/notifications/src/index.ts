// Contrats d'événements du bounded context **Notifications**
// (`context:notifications`, ADR-0004). Émis par `svc-notifications` via l'outbox
// (stream `NOTIFICATIONS`). L'enveloppe partagée vit dans
// `@creche-planner/contracts-kernel`.
export * from './lib/events/notifications-events.js';
