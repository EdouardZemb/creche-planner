import { getNodeAutoInstrumentations } from '@opentelemetry/auto-instrumentations-node';
import { OTLPMetricExporter } from '@opentelemetry/exporter-metrics-otlp-http';
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-http';
import { resourceFromAttributes } from '@opentelemetry/resources';
import { PeriodicExportingMetricReader } from '@opentelemetry/sdk-metrics';
import { NodeSDK } from '@opentelemetry/sdk-node';
import {
  ATTR_SERVICE_NAME,
  ATTR_SERVICE_VERSION,
} from '@opentelemetry/semantic-conventions';

let sdk: NodeSDK | undefined;

/**
 * Démarre le SDK OpenTelemetry et enregistre l'auto-instrumentation Node
 * (HTTP/Express/NestJS/pino…). **Doit être appelé avant l'import de tout module
 * instrumenté** : chaque app le lance depuis son `tracing.ts`, premier import de
 * `main.ts`, pour que les hooks soient posés avant le chargement d'Express/NATS.
 *
 * Le `traceparent` W3C est propagé automatiquement sur les appels HTTP sortants
 * (gateway → service) ; l'instrumentation pino injecte `trace_id`/`span_id` dans
 * chaque ligne de log, ce qui corrèle les logs des deux services.
 *
 * **Métriques** (P2-3, doc 18) : un `MeterProvider` est enregistré via le
 * `metricReader` du SDK (`PeriodicExportingMetricReader` + exporter OTLP/HTTP), sur
 * le même `OTEL_EXPORTER_OTLP_ENDPOINT` que les traces. Cela rend opérantes les
 * métriques applicatives émises via l'API OTel (ex. `tarification_repli_planification_total`)
 * : SDK service → collecteur (pipeline metrics → exporter prometheus) → Prometheus →
 * alertes/Alertmanager. Sans ce reader, l'API `metrics.getMeter()` est un no-op.
 *
 * Endpoint d'export : `OTEL_EXPORTER_OTLP_ENDPOINT` (défaut http://localhost:4318).
 */
export function startTracing(serviceName: string): void {
  if (sdk) {
    return;
  }

  sdk = new NodeSDK({
    resource: resourceFromAttributes({
      [ATTR_SERVICE_NAME]: serviceName,
      [ATTR_SERVICE_VERSION]: process.env['npm_package_version'] ?? '0.0.1',
    }),
    traceExporter: new OTLPTraceExporter(),
    // Export périodique des métriques (15 s) vers le collecteur OTel, qui les
    // réexpose au format Prometheus (cf. docker/otel-collector-config.yaml).
    metricReader: new PeriodicExportingMetricReader({
      exporter: new OTLPMetricExporter(),
      exportIntervalMillis: 15000,
    }),
    instrumentations: [
      getNodeAutoInstrumentations({
        // Bruyant et sans valeur ici : on coupe l'instrumentation du système de fichiers.
        '@opentelemetry/instrumentation-fs': { enabled: false },
      }),
    ],
  });

  sdk.start();

  const arret = (): void => {
    void sdk?.shutdown().finally(() => process.exit(0));
  };
  process.once('SIGTERM', arret);
  process.once('SIGINT', arret);
}
