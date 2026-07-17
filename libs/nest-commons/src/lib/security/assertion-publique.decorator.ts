import { SetMetadata } from '@nestjs/common';

/** Clé de métadonnée marquant une route exemptée d'assertion inter-services. */
export const ASSERTION_PUBLIQUE_KEY = 'assertion:publique';

/**
 * Exempte une route (ou un contrôleur entier) de la vérification d'assertion
 * inter-services — le {@link AssertionIdentiteGuard} la laisse passer sans exiger
 * d'en-tête `x-assertion-identite`.
 *
 * Deux usages **non négociables** :
 * - les routes de `HealthModule` (`/api/health*`), sondées **sans en-tête** par les
 *   healthchecks docker et le blackbox-exporter — sans l'exemption, tout le
 *   monitoring tomberait au premier passage en enforce ;
 * - `POST /api/desabonnement` (svc-foyer, H5) : point d'entrée RGPD one-click,
 *   **auto-authentifié** par son propre jeton HMAC, ouvert à un client de messagerie
 *   sans session.
 *
 * ⚠️ `POST /api/desabonnement/jetons` (interne) n'est **pas** exempté : il est appelé
 * par svc-notifications avec une assertion machine.
 */
export const AssertionPubliqueInterServices = (): MethodDecorator &
  ClassDecorator => SetMetadata(ASSERTION_PUBLIQUE_KEY, true);
