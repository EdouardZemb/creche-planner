import { z } from 'zod';
import {
  CLES_ETABLISSEMENT,
  type CleEtablissement,
} from '../etablissement/etablissement.dto.js';
import type { StatutEnvoi } from '../database/schema.js';
import type { DeltaModifs } from '../validation/validation.diff.js';
import { estSemaineIso } from '@creche-planner/shared-semaine';

/** Un enfant du foyer concerné par le récap d'un établissement (diff figé du Lot 4). */
export interface EnfantBrouillon {
  readonly contratId: string;
  readonly enfant: string;
  /** Jours modifiés affichés dans la relecture (delta figé à la validation). */
  readonly deltaModifs: DeltaModifs;
}

/**
 * Brouillon **régénérable** du mail **agrégé par établissement** (`GET …/brouillon`).
 * Lecture seule : il rassemble, pour `(foyer, semaine, établissement)`, **tous les
 * enfants** du foyer dont la semaine a été validée avec modifications, et rend un seul
 * corps. Le `dryRun` indique si un envoi réel **serait neutralisé** (bac à sable ou
 * destinataire hors allowlist) — il pilote le bandeau d'avertissement du front avant
 * le clic « Envoyer ».
 */
export interface BrouillonEtablissementVue {
  readonly foyerId: string;
  readonly semaineIso: string;
  /** Clé de l'établissement destinataire (`CRECHE_HIRONDELLES` | `ABCM`). */
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
  /** Enfants concernés (vide ⇒ rien à envoyer pour cet établissement). */
  readonly enfants: readonly EnfantBrouillon[];
  /** Vrai si un envoi réel serait neutralisé (dry-run global ou hors allowlist). */
  readonly dryRun: boolean;
}

/**
 * Résultat d'un envoi (`POST /envois/etablissement`). `statut` reflète l'issue réelle
 * (`ENVOYE` SMTP réel, `DRY_RUN` neutralisé, `ECHEC` transport en erreur) ;
 * `messageId`/`erreur` sont renseignés selon le cas. Idempotent : ré-émettre le même
 * `(foyer, semaine, établissement)` renvoie le résultat déjà journalisé sans renvoyer
 * de mail.
 */
export interface EnvoiEtablissementResultat {
  readonly foyerId: string;
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
 * Corps de la demande d'envoi (`POST /envois/etablissement`) : la cible
 * `(foyer, semaine, établissement)`. Le destinataire n'est **pas** au choix du
 * client — il est résolu côté service depuis l'annuaire, pour qu'on ne puisse pas
 * adresser un récap à une adresse arbitraire.
 */
export const envoiEtablissementSchema = z.object({
  foyerId: z.uuid('foyerId doit être un UUID'),
  semaineIso: z
    .string()
    .refine(estSemaineIso, 'semaine ISO invalide (attendu YYYY-Www)'),
  cle: z.enum(CLES_ETABLISSEMENT),
});
export type EnvoiEtablissementDto = z.infer<typeof envoiEtablissementSchema>;
