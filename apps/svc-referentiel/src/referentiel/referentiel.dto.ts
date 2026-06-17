import {
  BadRequestException,
  Injectable,
  type PipeTransform,
} from '@nestjs/common';
import { z, type ZodType } from 'zod';

/**
 * Publication d'une grille ABCM versionnée (montants saisis en **euros**). La
 * cohérence de période et de tranche est revalidée par le domaine côté service.
 * Dates : `z.iso.date()` valide le calendrier réel (AQ-04 — `2026-02-30` rejeté).
 */
export const publierGrilleAbcmSchema = z.object({
  tranche: z.number().int(),
  valideDu: z.iso.date('date ISO YYYY-MM-DD attendue'),
  valideAu: z.iso.date('date ISO YYYY-MM-DD attendue').nullable().optional(),
  cantineTotal: z.number().nonnegative(),
  cantinePartGarde: z.number().nonnegative().optional(),
  periMatin: z.number().nonnegative(),
  periSoir: z.number().nonnegative(),
  alshJourneeComplete: z.number().nonnegative(),
  alshDemiJournee: z.number().nonnegative(),
  alshRepas: z.number().nonnegative(),
});
export type PublierGrilleAbcmDto = z.infer<typeof publierGrilleAbcmSchema>;

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
