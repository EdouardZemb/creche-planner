import {
  BadRequestException,
  Injectable,
  type PipeTransform,
} from '@nestjs/common';
import { z, type ZodType } from 'zod';
import { MODES_CONTRAT } from '@creche-planner/contracts-planification';

/**
 * Clés stables des établissements destinataires. Volontairement **distinctes** des
 * modes de garde (`MODES_CONTRAT`) : « ABCM » est un établissement regroupant
 * `PERISCOLAIRE`/`CANTINE`/`ALSH`, pas un mode. Le destinataire d'un mail se
 * résout donc du `mode` du contrat vers une de ces clés (cf. `cleEtablissementPourMode`).
 */
export const CLES_ETABLISSEMENT = ['CRECHE_HIRONDELLES', 'ABCM'] as const;
export type CleEtablissement = (typeof CLES_ETABLISSEMENT)[number];

/** Jours de la semaine (règle de préavis « jour + heure », ex. jeudi 12h ABCM). */
export const JOURS_SEMAINE = [
  'LUNDI',
  'MARDI',
  'MERCREDI',
  'JEUDI',
  'VENDREDI',
  'SAMEDI',
  'DIMANCHE',
] as const;

/** Heure du jour `HH:MM` (00:00 → 23:59). */
const HEURE = /^([01]\d|2[0-3]):[0-5]\d$/;

/**
 * Règle de préavis d'un établissement, **union discriminée par `type`** :
 * - `JOURS_OUVRES` : un nombre de jours ouvrés (ex. 2 jours, RM-03 crèche) ;
 * - `JOUR_HEURE` : un jour + une heure butoir (ex. jeudi 12:00, RM-07 ABCM).
 */
export const preavisRegleSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('JOURS_OUVRES'),
    valeur: z.number().int().min(0).max(30),
  }),
  z.object({
    type: z.literal('JOUR_HEURE'),
    jour: z.enum(JOURS_SEMAINE),
    heure: z.string().regex(HEURE, 'heure attendue au format HH:MM'),
  }),
]);

/**
 * Corps d'upsert d'un établissement (`PUT /etablissements/:cle`). La clé voyage
 * dans l'URL ; le corps porte les champs éditables. `libelle`/`actif` sont
 * optionnels : à la création d'une ligne absente, ils prennent un défaut (libellé
 * = clé, actif = vrai) ; à la mise à jour, ils ne sont touchés que s'ils sont fournis.
 */
export const upsertEtablissementSchema = z.object({
  emailService: z.email('adresse e-mail invalide'),
  preavisRegle: preavisRegleSchema,
  libelle: z.string().min(1).max(200).optional(),
  actif: z.boolean().optional(),
});
export type UpsertEtablissementDto = z.infer<typeof upsertEtablissementSchema>;

/**
 * Mapping **codé** `mode de garde → clé d'établissement` : `CRECHE_PSU` →
 * `CRECHE_HIRONDELLES` ; `PERISCOLAIRE`/`CANTINE`/`ALSH` → `ABCM`. Exhaustif sur
 * `MODES_CONTRAT` (un mode ajouté en amont casserait le typage ici, par dessein).
 */
export const MODE_VERS_CLE: Readonly<
  Record<(typeof MODES_CONTRAT)[number], CleEtablissement>
> = {
  CRECHE_PSU: 'CRECHE_HIRONDELLES',
  PERISCOLAIRE: 'ABCM',
  CANTINE: 'ABCM',
  ALSH: 'ABCM',
};

/** Résout la clé d'établissement destinataire à partir du mode d'un contrat. */
export function cleEtablissementPourMode(
  mode: (typeof MODES_CONTRAT)[number],
): CleEtablissement {
  return MODE_VERS_CLE[mode];
}

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
