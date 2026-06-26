import { SetMetadata } from '@nestjs/common';

/** Clé de métadonnée marquant une route comme réservée à l'administrateur. */
export const ADMIN_KEY = 'gateway:admin';

/**
 * Marque une route (ou un contrôleur entier) comme **réservée à l'administrateur**
 * (option b-ii, provisioning admin) : le {@link AdminGuard} exige que l'e-mail
 * vérifié de l'identité (Cloudflare Access B1) soit dans l'allowlist
 * `ADMIN_EMAILS`, **lorsque le gating est actif** (allowlist non vide). Utilisé
 * pour gater la création de foyer et la CRUD des parents.
 */
export const AdminSeulement = () => SetMetadata(ADMIN_KEY, true);
