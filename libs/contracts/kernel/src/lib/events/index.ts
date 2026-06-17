// Enveloppe générique d'événement d'intégration partagée par tous les contextes.
// Les événements métier vivent dans la lib de contrat de leur contexte propriétaire
// (`@creche-planner/contracts-<contexte>`), pas ici (ADR-0004, décision 1 & 4).
export * from './integration-event.js';
