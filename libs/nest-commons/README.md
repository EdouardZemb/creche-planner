# nest-commons

Boilerplate NestJS partagé par les 4 services backend (AQ-07, doc 27) :

- `DomainExceptionFilter` — traduit toute `DomainError` en HTTP 400 ;
- `traceIdCourant()` — corrélation OTel des événements d'intégration ;
- `DatabaseModule.forRoot({ schema, urlBase, dossierMigrations })` — client
  postgres.js paresseux + Drizzle + `MigrationService` (migrations au boot,
  résilient) ;
- `NatsModule.forRoot({ service, stream, sujet, url })` — connexion JetStream
  résiliente, provisionnement idempotent du stream du contexte, publication
  dédupliquée par `Nats-Msg-Id` (+ accès connexion/JetStream pour les
  consommateurs durables) ;
- `HealthModule` — readiness (`/health` : DB + NATS) et liveness
  (`/health/live`) via Terminus ;
- `OutboxModule.forRoot({ source, table })` — relais de l'outbox
  transactionnelle (doc 06 §8.4), at-least-once.

Chaque service garde : son `config.ts` (port, URLs), son schéma Drizzle et ses
migrations (la table `outbox` doit rester conforme à `TableOutbox`), et un alias
local `Database = PostgresJsDatabase<typeof schema>` pour typer ses injections.

Tags Nx : `type:infrastructure`, `context:shared`.
