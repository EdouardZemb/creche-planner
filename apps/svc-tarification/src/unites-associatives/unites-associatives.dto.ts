import {
  BadRequestException,
  Injectable,
  type PipeTransform,
} from '@nestjs/common';
import { z, type ZodType } from 'zod';
import {
  ETATS_SESSION_UA,
  TYPES_SESSION_UA,
} from '@creche-planner/tarification-domain';

/**
 * Corps de saisie des unités associatives (SFD 40). Aucune valeur associative
 * n'est ici un **défaut** : quota, valeur d'UA et bornes de période sont requis
 * (`RM-40-02`). Ce que la doc 02 §4.5 propose — 20 h, 31,25 €, 1er juin →
 * 31 mai — est une **proposition d'écran**, pré-remplie côté front ; le service,
 * lui, n'invente aucun chiffre.
 */
export const declarerEngagementSchema = z
  .object({
    debut: z.iso.date('date ISO YYYY-MM-DD attendue'),
    fin: z.iso.date('date ISO YYYY-MM-DD attendue'),
    /** Quota d'UA dues (1 UA = 1 h) ; décimal admis (variante 10 UA par parent). */
    quotaHeures: z.number().nonnegative().max(2000),
    valeurUaCentimes: z.number().int().nonnegative(),
    /** Caution déposée, **informative** : Martha ne touche à aucun paiement. */
    cautionCentimes: z.number().int().nonnegative().optional(),
  })
  .refine((v) => v.debut < v.fin, {
    message: 'la fin de période doit suivre son début',
    path: ['fin'],
  });
export type DeclarerEngagementDto = z.infer<typeof declarerEngagementSchema>;

/**
 * Ajout d'une session — la saisie que `US-40-02` veut « en quatre champs, depuis
 * mon téléphone » : date, durée, type, qui s'y colle. Le reste est facultatif.
 * L'état n'est pas saisissable à la création : une session naît `PREVUE`
 * (`US-40-02` CA2), et c'est un geste explicite qui la fait avancer.
 */
export const ajouterSessionSchema = z.object({
  engagementId: z.uuid(),
  date: z.iso.date('date ISO YYYY-MM-DD attendue'),
  dureeHeures: z.number().positive().max(24),
  type: z.enum(TYPES_SESSION_UA),
  realisePar: z.string().min(1).max(200).optional(),
  etablissementId: z.uuid().optional(),
});
export type AjouterSessionDto = z.infer<typeof ajouterSessionSchema>;

/**
 * Modification d'une session : l'état (le geste courant — « c'est fait », « ça
 * n'a pas eu lieu ») et, accessoirement, ses champs. Tous facultatifs : un corps
 * `{ etat: 'REALISEE' }` doit suffire, sinon marquer un créneau fait redemanderait
 * de ressaisir la ligne entière.
 */
export const modifierSessionSchema = z
  .object({
    etat: z.enum(ETATS_SESSION_UA).optional(),
    date: z.iso.date('date ISO YYYY-MM-DD attendue').optional(),
    dureeHeures: z.number().positive().max(24).optional(),
    type: z.enum(TYPES_SESSION_UA).optional(),
    realisePar: z.string().min(1).max(200).optional(),
  })
  .refine((v) => Object.values(v).some((valeur) => valeur !== undefined), {
    message: 'au moins un champ à modifier attendu',
  });
export type ModifierSessionDto = z.infer<typeof modifierSessionSchema>;

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
