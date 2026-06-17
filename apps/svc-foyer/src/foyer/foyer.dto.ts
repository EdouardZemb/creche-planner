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
