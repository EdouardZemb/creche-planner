import { z } from 'zod';

/**
 * **Format d'erreur unique de la passerelle — RFC 9457 « Problem Details for
 * HTTP APIs »** (`AM-37`, lot 4 des standards).
 *
 * Avant ce contrat, quatre formes d'erreur atteignaient le navigateur selon la
 * route empruntée : le corps par défaut de Nest (`{ statusCode, message,
 * error }`), le 409 structuré de `svc-foyer`/`svc-referentiel`
 * (`{ statusCode, code, message }`), le repli du relais BFF
 * (`{ statut, message, detail }`) et le 400 du `DomainExceptionFilter` des
 * services (`{ statusCode, error, message }`). Un consommateur ne pouvait donc
 * pas écrire **une** lecture d'erreur : il en écrivait une par route, ou il
 * n'en écrivait aucune — c'est ce dernier cas qui s'est produit (`AN-21`).
 *
 * Ce module porte la **cible** : les membres normalisés de la RFC, les deux
 * membres d'extension que le produit utilise réellement (`code`, `erreurs`) et
 * le registre des codes métier. Il ne dépend d'aucun framework HTTP : la
 * passerelle le traduit (`ProblemeFilter`), le front le lit (`utils/erreurs`),
 * le document OpenAPI en **dérive** son schéma.
 */

/**
 * Codes métier que la passerelle peut exposer. Un `code` distingue **la cause**
 * d'un statut qui, seul, n'en dit rien : trois 409 différents ne se traitent pas
 * de la même façon côté écran. Le registre est la source de vérité unique —
 * l'énumération du document OpenAPI et le `type` de chaque problème en dérivent,
 * et la porte `pnpm problemes` refuse un code émis par un service sans entrée ici.
 */
export const CODES_PROBLEME = {
  EMAIL_DEJA_UTILISE: 'adresse e-mail déjà utilisée dans ce foyer',
  PARENT_PRINCIPAL_EXISTANT: 'un parent principal existe déjà pour ce foyer',
  DERNIER_PARENT_ACTIF: 'le dernier parent actif ne peut pas être retiré',
  PERIODE_CHEVAUCHANTE: 'la période chevauche une version existante',
  RESSOURCES_INCONNUES_AU_MOIS:
    'aucune version de ressources ne couvre ce mois — le coût ne peut pas être calculé',
  SEMAINE_HORS_FENETRE_ENVOI:
    'la semaine est trop ancienne pour qu’un récapitulatif parte vers l’établissement',
  RECAP_SANS_MODIFICATION:
    'aucune modification à transmettre : le récapitulatif n’a rien à dire',
  ZONE_SCOLAIRE_ABSENTE:
    'aucune zone de vacances scolaires n’est renseignée pour cet établissement',
  IMPORT_CALENDRIER_INDISPONIBLE:
    'le calendrier scolaire officiel n’a pas pu être importé — la saisie manuelle reste possible',
} as const;

/** Code métier d'un problème, tel que le front peut le discriminer. */
export type CodeProbleme = keyof typeof CODES_PROBLEME;

/** Vrai si `valeur` est un code métier connu du registre. */
export function estCodeProbleme(valeur: unknown): valeur is CodeProbleme {
  return typeof valeur === 'string' && valeur in CODES_PROBLEME;
}

/**
 * URI de référence d'un code métier. **Dérivée** du code, jamais recopiée : une
 * URN plutôt qu'une URL parce qu'un problème n'a pas de page à servir et qu'une
 * URL morte est pire que pas d'URL (RFC 9457 §3.1.1 admet un `type` non
 * déréférençable). En l'absence de code, la RFC impose `about:blank`, dont le
 * `title` est alors la phrase du statut HTTP.
 */
export function typeProbleme(code: CodeProbleme): string {
  return `urn:probleme:creche-planner:${code.toLowerCase().replaceAll('_', '-')}`;
}

/** Erreur rattachée à un champ de la requête (membre d'extension `erreurs`). */
export const erreurChampSchema = z.object({
  champ: z.string(),
  message: z.string(),
});

/** Erreur de validation rattachée à un champ précis. */
export type ErreurChamp = z.infer<typeof erreurChampSchema>;

/**
 * Un problème tel qu'il circule sur le fil, en `application/problem+json`.
 *
 * - `type`, `title`, `status`, `detail`, `instance` sont les membres RFC 9457 ;
 * - `code` et `erreurs` sont des **membres d'extension**, explicitement permis
 *   par la RFC (§3.2) et nécessaires ici : sans `code`, l'écran ne sait pas
 *   *pourquoi* un 409 ; sans `erreurs`, un 400 de validation ne peut pas être
 *   rendu champ par champ.
 *
 * `title` résume le **type** de problème (stable pour un `type` donné) ; `detail`
 * décrit **cette occurrence** et peut varier. Aucun des deux n'est destiné à la
 * machine : c'est `type`/`code` qui se testent.
 */
export const problemeSchema = z.object({
  type: z.string(),
  title: z.string(),
  status: z.number().int(),
  detail: z.string().optional(),
  instance: z.string().optional(),
  code: z
    .enum(Object.keys(CODES_PROBLEME) as [CodeProbleme, ...CodeProbleme[]])
    .optional(),
  erreurs: z.array(erreurChampSchema).optional(),
});

/** Corps d'erreur unique de la passerelle (RFC 9457). */
export type Probleme = z.infer<typeof problemeSchema>;

/** Type de média imposé par la RFC 9457 pour ce corps. */
export const MEDIA_TYPE_PROBLEME = 'application/problem+json';
