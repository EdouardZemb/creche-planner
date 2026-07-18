import { z } from 'zod';
import type {
  StatutEnvoi,
  StatutEnvoiRecap,
  StatutEnvoiRecapParent,
} from '../database/schema.js';
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
   * Vrai si l'établissement est **joignable** : il a une adresse de service **ET** il est
   * **actif** (non archivé). Faux ⇒ **aucun** envoi possible (le front affiche un
   * avertissement au lieu du bouton, et `envoyer()` refuse côté serveur).
   */
  readonly routable: boolean;
  /**
   * Raison de non-routabilité quand `routable === false`, sinon `null`. `'ARCHIVE'` a la
   * **priorité** sur `'SANS_EMAIL'` : une crèche archivée est signalée « archivée » (geste
   * de réactivation) même si elle n'a par ailleurs pas d'e-mail.
   */
  readonly raisonNonRoutable: 'SANS_EMAIL' | 'ARCHIVE' | null;
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
 *
 * `sujet`/`corps` sont **optionnels** (rétro-compatibles) : fournis ensemble, ils
 * remplacent le brouillon régénéré côté serveur (le parent a relu/édité le texte dans
 * l'app) ; le corps est du **texte brut** échappé en HTML au moment de l'envoi (jamais
 * du HTML libre du client). Absents, le comportement historique (régénération depuis le
 * delta) est conservé. Invariant : les deux ensemble ou aucun (sinon 400).
 */
export const envoiEtablissementSchema = z
  .object({
    foyerId: z.uuid('foyerId doit être un UUID'),
    semaineIso: z
      .string()
      .refine(estSemaineIso, 'semaine ISO invalide (attendu YYYY-Www)'),
    etablissementId: z.uuid('etablissementId doit être un UUID'),
    sujet: z.string().min(1).max(300).optional(),
    corps: z.string().min(1).max(20000).optional(),
  })
  .refine((d) => (d.sujet == null) === (d.corps == null), {
    message: 'objet et corps doivent être fournis ensemble',
    path: ['corps'],
  });
export type EnvoiEtablissementDto = z.infer<typeof envoiEtablissementSchema>;

// --- Suivi des envois (B1, LECTURE SEULE) -----------------------------------

/**
 * Livraison du récap du mardi vers **un parent** du foyer (ledger
 * `envoi_recap_parent`). `essais` compte les tentatives en échec ; `envoyeLe` est nul
 * tant que la ligne n'a pas abouti.
 */
export interface SuiviRappelParent {
  readonly email: string;
  readonly statut: StatutEnvoiRecapParent;
  readonly envoyeLe: string | null;
  readonly essais: number;
}

/**
 * État d'envoi du **rappel hebdomadaire du mardi** d'un foyer pour une semaine
 * (agrégat `envoi_recap_hebdo` + détail par parent `envoi_recap_parent`). `null` côté
 * vue quand aucun slot n'a été programmé (semaine jamais notifiée).
 */
export interface SuiviRappelHebdo {
  readonly statut: StatutEnvoiRecap;
  readonly envoyeLe: string | null;
  readonly erreur: string | null;
  readonly parents: readonly SuiviRappelParent[];
}

/**
 * État d'envoi du récap **agrégé vers un établissement** (`envoi_etablissement`) pour la
 * semaine. `destinataire` est l'adresse figée à l'envoi (preuve).
 */
export interface SuiviEnvoiEtablissement {
  readonly etablissementId: string;
  readonly statut: StatutEnvoi;
  readonly envoyeLe: string | null;
  readonly erreur: string | null;
  readonly destinataire: string | null;
}

/**
 * Vue **LECTURE SEULE** du suivi des envois d'une `(foyer, semaine)` (B1) : le statut
 * **persistant** du rappel hebdo aux parents et des envois aux établissements, rendu
 * consultable dans l'encart de validation (plus seulement dans l'état React éphémère).
 * Aucune écriture : trois `select` par `(foyer_id, semaine_iso)`.
 */
export interface SuiviEnvoisVue {
  readonly foyerId: string;
  readonly semaineIso: string;
  readonly rappel: SuiviRappelHebdo | null;
  readonly etablissements: readonly SuiviEnvoiEtablissement[];
}
