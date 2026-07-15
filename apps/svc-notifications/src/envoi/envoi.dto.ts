import { z } from 'zod';
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
  /** Identifiant réel de l'établissement destinataire (read model `etablissement`). */
  readonly etablissementId: string;
  /** Libellé lisible de l'établissement (en-tête du mail). */
  readonly etablissementLibelle: string;
  /**
   * Adresse e-mail réellement visée (mise en évidence côté front). **Chaîne vide** `''`
   * quand l'établissement n'est pas joignable (`routable === false`) : le front ne lit
   * `destinataire` que lorsque `routable === true`.
   */
  readonly destinataire: string;
  readonly sujet: string;
  /** Corps rendu (HTML) — exactement ce qui serait figé/envoyé. */
  readonly corps: string;
  /** Corps rendu (texte brut), pour l'aperçu accessible. */
  readonly texte: string;
  /** Enfants concernés (vide ⇒ rien à envoyer pour cet établissement). */
  readonly enfants: readonly EnfantBrouillon[];
  /**
   * Vrai si l'établissement est **joignable** (a une adresse de service) : le récap peut
   * être envoyé. Faux ⇒ **aucun** envoi possible (le front affiche un avertissement au
   * lieu du bouton, et `envoyer()` refuse côté serveur). (Un lot ultérieur étendra la
   * condition à « ET actif ».)
   */
  readonly routable: boolean;
  /**
   * Raison de non-routabilité quand `routable === false`, sinon `null`. Union tenue
   * **exacte** (un lot ultérieur y ajoutera `'ARCHIVE'`).
   */
  readonly raisonNonRoutable: 'SANS_EMAIL' | null;
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
  readonly etablissementId: string;
  readonly destinataire: string;
  readonly statut: StatutEnvoi;
  readonly messageId: string | null;
  readonly erreur: string | null;
  /** Horodatage de complétion ISO 8601 (`null` tant que `EN_COURS`). */
  readonly envoyeLe: string | null;
}

/**
 * Corps de la demande d'envoi (`POST /envois/etablissement`) : la cible
 * `(foyer, semaine, établissement)`. L'établissement est désigné par son `id` réel
 * (read model `etablissement`) ; le destinataire n'est **pas** au choix du client — il
 * est résolu côté service depuis la fiche projetée, pour qu'on ne puisse pas adresser un
 * récap à une adresse arbitraire.
 */
export const envoiEtablissementSchema = z.object({
  foyerId: z.uuid('foyerId doit être un UUID'),
  semaineIso: z
    .string()
    .refine(estSemaineIso, 'semaine ISO invalide (attendu YYYY-Www)'),
  etablissementId: z.uuid('etablissementId doit être un UUID'),
});
export type EnvoiEtablissementDto = z.infer<typeof envoiEtablissementSchema>;
