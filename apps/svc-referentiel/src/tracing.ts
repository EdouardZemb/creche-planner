import { startTracing } from '@creche-planner/observability';

// Premier import de main.ts : démarre OpenTelemetry AVANT tout module instrumenté
// (Express, pino…), afin que les hooks d'auto-instrumentation soient en place.
startTracing(process.env['OTEL_SERVICE_NAME'] ?? 'svc-referentiel');
