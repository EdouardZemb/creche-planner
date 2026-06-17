import { startTracing } from '@creche-planner/observability';

// Premier import de main.ts : démarre OpenTelemetry AVANT tout module instrumenté
// (Express, fetch/undici…), pour propager le traceparent W3C vers les services.
startTracing(process.env['OTEL_SERVICE_NAME'] ?? 'api-gateway');
