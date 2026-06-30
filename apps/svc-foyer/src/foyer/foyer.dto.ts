import {
  BadRequestException,
  Injectable,
  type PipeTransform,
} from '@nestjs/common';
import { z, type ZodType } from 'zod';

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
