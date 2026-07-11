import {
  BadRequestException,
  Injectable,
  type PipeTransform,
} from '@nestjs/common';
import { z, type ZodType } from 'zod';
import {
  canalSchema,
  typeNotificationSchema,
} from '@creche-planner/contracts-foyer';

/** Création/mise à jour des finances d'un foyer. Montants saisis en **euros**. */
export const ecrireFoyerSchema = z.object({
  ressourcesMensuelles: z.number().nonnegative(),
  rfr: z.number().nonnegative(),
  nbEnfantsACharge: z.number().int().min(1),
  nbParts: z.number().positive(),
});
export type EcrireFoyerDto = z.infer<typeof ecrireFoyerSchema>;

/** Rattachement d'un enfant au foyer. Date : calendrier réel validé (AQ-04). */
export const ajouterEnfantSchema = z.object({
  prenom: z.string().min(1),
  dateNaissance: z.iso.date('date ISO YYYY-MM-DD attendue'),
});
export type AjouterEnfantDto = z.infer<typeof ajouterEnfantSchema>;

/**
 * Édition d'un enfant (`PUT`). Prénom + date sont requis (l'écran édite les deux
 * et l'événement `EnfantModifie` transporte l'état complet) ; même validation que
 * l'ajout. La suppression (`DELETE`) ne porte pas de corps (hard delete).
 */
export const modifierEnfantSchema = ajouterEnfantSchema;
export type ModifierEnfantDto = z.infer<typeof modifierEnfantSchema>;

/**
 * Rattachement d'un parent au foyer. `email` est requis (destinataire des
 * notifications + futur identifiant de login) ; `prenom`/`nom` sont une identité
 * douce optionnelle. `principal`/`ordre` ont un défaut pour une création minimale.
 */
export const ajouterParentSchema = z.object({
  email: z.email('adresse e-mail invalide'),
  prenom: z.string().min(1).max(200).optional(),
  nom: z.string().min(1).max(200).optional(),
  principal: z.boolean().default(false),
  ordre: z.number().int().min(0).default(0),
});
export type AjouterParentDto = z.infer<typeof ajouterParentSchema>;

/**
 * Création **atomique** d'un foyer et de son dossier (`POST /api/foyers`) : les
 * scalaires du foyer **plus**, optionnellement, ses enfants et parents, insérés
 * dans une **seule transaction**. Les champs de dossier sont facultatifs — le
 * corps scalaire seul reste accepté (rétrocompatible). Bornes défensives :
 * ≤ 20 enfants, ≤ 10 parents. `createurEmail` = e-mail vérifié du **créateur
 * non-admin** (fourni par la gateway) ; `FoyerService.creer` le rattache comme
 * parent s'il n'est pas déjà saisi (dédoublonnage insensible à la casse).
 */
export const creerFoyerSchema = ecrireFoyerSchema.extend({
  enfants: z.array(ajouterEnfantSchema).max(20).default([]),
  parents: z.array(ajouterParentSchema).max(10).default([]),
  createurEmail: z.email('adresse e-mail invalide').optional(),
});
export type CreerFoyerDto = z.infer<typeof creerFoyerSchema>;

/**
 * Édition d'un parent (`PUT`). Tous les champs sont optionnels : seuls ceux
 * fournis sont modifiés (sémantique d'upsert partiel, cf. établissements).
 * `prenom`/`nom` acceptent `null` pour effacer l'identité douce ; `actif`
 * permet de réactiver un parent retiré (soft-delete).
 */
export const modifierParentSchema = z.object({
  email: z.email('adresse e-mail invalide').optional(),
  prenom: z.string().min(1).max(200).nullable().optional(),
  nom: z.string().min(1).max(200).nullable().optional(),
  principal: z.boolean().optional(),
  ordre: z.number().int().min(0).optional(),
  actif: z.boolean().optional(),
});
export type ModifierParentDto = z.infer<typeof modifierParentSchema>;

/**
 * Mise à jour des **préférences de notification** d'un parent (`PUT`). On envoie
 * la liste des choix explicites `(type, canal, actif)` à matérialiser ; les
 * combinaisons absentes retombent sur le défaut applicatif (§5.1). `min(1)` : un
 * `PUT` vide n'a pas de sens (l'écran envoie toujours l'état des cases). Le
 * doublon `(type, canal)` est écarté par l'unicité en base ; l'invariant « ≥ 1
 * canal actif pour un type de service » est appliqué par le service (400).
 */
export const majPreferencesSchema = z.object({
  preferences: z
    .array(
      z.object({
        typeNotification: typeNotificationSchema,
        canal: canalSchema,
        actif: z.boolean(),
      }),
    )
    .min(1, 'au moins une préférence attendue'),
});
export type MajPreferencesDto = z.infer<typeof majPreferencesSchema>;

/** Pipe générique : valide le corps de requête contre un schéma Zod (→ 400). */
@Injectable()
export class ZodValidationPipe<T> implements PipeTransform<unknown, T> {
  constructor(private readonly schema: ZodType<T>) {}

  transform(value: unknown): T {
    const resultat = this.schema.safeParse(value);
    if (!resultat.success) {
      throw new BadRequestException(
        resultat.error.issues.map((i) => ({
          champ: i.path.join('.'),
          message: i.message,
        })),
      );
    }
    return resultat.data;
  }
}
