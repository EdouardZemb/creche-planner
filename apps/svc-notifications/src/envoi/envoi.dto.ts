import { z } from 'zod';
import type { CleEtablissement } from '../etablissement/etablissement.dto.js';
import type { StatutEnvoi } from '../database/schema.js';
import type { DeltaModifs } from '../validation/validation.diff.js';
import { estSemaineIso } from '../validation/semaine.js';

/**
 * Brouillon **régénérable** du mail de service (`GET .../brouillon`). Lecture seule :
 * il résout le destinataire (annuaire × mode du contrat), le sujet et le corps rendu
 * à partir du `delta_modifs` figé à la validation. Le `dryRun` indique si un envoi
 * réel **serait neutralisé** (bac à sable ou destinataire hors allowlist) — il pilote
 * le bandeau d'avertissement du front avant le clic « Envoyer ».
 */
export interface BrouillonVue {
  readonly contratId: string;
  readonly semaineIso: string;
  /** Clé de l'établissement destinataire résolu (`CRECHE_HIRONDELLES` | `ABCM`). */
  readonly etablissementCle: CleEtablissement;
  /** Libellé lisible de l'établissement (en-tête du mail). */
  readonly etablissementLibelle: string;
  /** Adresse e-mail réellement visée (mise en évidence côté front). */
  readonly destinataire: string;
  readonly sujet: string;
  /** Corps rendu (HTML) — exactement ce qui serait figé/envoyé. */
  readonly corps: string;
  /** Corps rendu (texte brut), pour l'aperçu accessible. */
  readonly texte: string;
  /** Jours modifiés affichés dans la relecture (diff du Lot 4). */
  readonly deltaModifs: DeltaModifs;
  /** Vrai si un envoi réel serait neutralisé (dry-run global ou hors allowlist). */
  readonly dryRun: boolean;
}

/**
 * Résultat d'un envoi (`POST /envois`). `statut` reflète l'issue réelle (`ENVOYE`
 * SMTP réel, `DRY_RUN` neutralisé, `ECHEC` transport en erreur) ; `messageId`/`erreur`
 * sont renseignés selon le cas. Idempotent : ré-émettre la même semaine renvoie le
 * résultat déjà journalisé sans renvoyer de mail.
 */
export interface EnvoiResultat {
  readonly contratId: string;
  readonly semaineIso: string;
  readonly etablissementCle: CleEtablissement;
  readonly destinataire: string;
  readonly statut: StatutEnvoi;
  readonly messageId: string | null;
  readonly erreur: string | null;
  /** Horodatage de complétion ISO 8601 (`null` tant que `EN_COURS`). */
  readonly envoyeLe: string | null;
}

/**
 * Corps de la demande d'envoi (`POST /envois`) : la cible (contrat + semaine). Le
 * destinataire n'est **pas** au choix du client — il est résolu côté service depuis
 * l'annuaire, pour qu'on ne puisse pas adresser un récap à une adresse arbitraire.
 */
export const envoiSchema = z.object({
  contratId: z.uuid('contratId doit être un UUID'),
  semaineIso: z
    .string()
    .refine(estSemaineIso, 'semaine ISO invalide (attendu YYYY-Www)'),
});
export type EnvoiDto = z.infer<typeof envoiSchema>;
