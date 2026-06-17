import type { Params } from 'nestjs-pino';

/**
 * Options du logger pino (via nestjs-pino) communes aux services.
 * Sortie **JSON par défaut** (logs structurés corrélables) ; `trace_id`/`span_id`
 * sont injectés automatiquement par l'instrumentation OpenTelemetry de pino.
 *
 * - `LOG_LEVEL` pilote le niveau (défaut `info`).
 * - `LOG_PRETTY=true` active pino-pretty en local (lecture humaine).
 */
export function buildLoggerParams(serviceName: string): Params {
  const usePretty = process.env['LOG_PRETTY'] === 'true';

  return {
    pinoHttp: {
      name: serviceName,
      level: process.env['LOG_LEVEL'] ?? 'info',
      autoLogging: true,
      // Identifiant de corrélation HTTP repris du header de propagation s'il existe.
      genReqId: (req): string =>
        (req.headers['x-request-id'] as string | undefined) ??
        (req.headers['traceparent'] as string | undefined) ??
        '',
      ...(usePretty
        ? {
            transport: {
              target: 'pino-pretty',
              options: { singleLine: true, translateTime: 'HH:MM:ss.l' },
            },
          }
        : {}),
    },
  };
}
