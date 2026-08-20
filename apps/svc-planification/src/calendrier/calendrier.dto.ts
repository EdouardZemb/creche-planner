import { z } from 'zod';
import { SERVICES_CALENDRIER } from '@creche-planner/planification-domain';
import { REGIMES_FERIES } from '@creche-planner/shared-kernel';

/**
 * Schémas d'entrée du **calendrier d'ouverture** (SFD 31, lot 2).
 *
 * Deux familles de valeurs temporelles, jamais confondues (cf. l'en-tête de
 * `calendrier-ouverture.ts`) :
 *
 * - les **dates métier** `YYYY-MM-DD` (`du`, `au`, `jour`) — `z.iso.date()`, qui
 *   refuse un 31 février là où une regex `\d{2}` l'accepterait (AQ-04) ;
 * - l'**instant de connaissance** `aLaDate` — horodatage UTC de largeur fixe
 *   `YYYY-MM-DDTHH:MM:SS.sssZ`. Le format est celui du type brandé `Instant` du
 *   `shared-kernel`, et il est **imposé ici, à la frontière** : un offset horaire
 *   (`+02:00`) casserait l'équivalence entre comparaison lexicographique et
 *   comparaison chronologique dont dépend toute la résolution.
 */

/** Horodatage UTC de largeur fixe — la forme littérale d'un `Instant`. */
const FORMAT_INSTANT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;

const instantSchema = z
  .string()
  .regex(
    FORMAT_INSTANT,
    'instant invalide (format attendu : YYYY-MM-DDTHH:MM:SS.sssZ, UTC)',
  );

/** Un service ouvrable par le calendrier, validé contre le catalogue du domaine. */
const serviceSchema = z.enum(SERVICES_CALENDRIER);

/**
 * Liste de services, validée **à l'écriture**. C'est la garde de la D2 : un mode
 * inconnu accepté ici dormirait en `jsonb` et ne casserait la résolution que des
 * mois plus tard, quand plus personne ne ferait le lien avec la saisie.
 */
const servicesSchema = z.array(serviceSchema);

/**
 * Plage de lecture du calendrier résolu. `aLaDate` **omis = maintenant** — le
 * défaut est explicite dans le document OpenAPI *et* réverbéré dans la réponse
 * (`aLaDate` y est echo), pour qu'un consommateur puisse constater l'instant
 * réellement employé au lieu de le supposer.
 */
export const lireCalendrierQuerySchema = z.object({
  du: z.iso.date(),
  au: z.iso.date(),
  aLaDate: instantSchema.optional(),
});

export type LireCalendrierQuery = z.infer<typeof lireCalendrierQuerySchema>;

/** Lecture d'une couche brute (récurrences, périodes, exceptions) à un instant. */
export const lireCoucheQuerySchema = z.object({
  aLaDate: instantSchema.optional(),
});

export type LireCoucheQuery = z.infer<typeof lireCoucheQuerySchema>;

/**
 * Remplacement **intégral** de la récurrence hebdomadaire. Le corps décrit la
 * semaine voulue ; le service clôt toutes les lignes ouvertes et ouvre les
 * nouvelles au **même** instant — une semaine type s'édite d'un bloc, elle ne se
 * relit jamais à moitié retouchée.
 */
export const remplacerRecurrencesSchema = z.object({
  recurrences: z.array(
    z.object({
      regime: z.enum(['SCOLAIRE', 'VACANCES']),
      jourSemaine: z.enum([
        'LUNDI',
        'MARDI',
        'MERCREDI',
        'JEUDI',
        'VENDREDI',
        'SAMEDI',
        'DIMANCHE',
      ]),
      services: servicesSchema,
    }),
  ),
});

export type RemplacerRecurrencesDto = z.infer<
  typeof remplacerRecurrencesSchema
>;

/**
 * Pose d'une exception ponctuelle. `services` omis = **tous** les services
 * (fermeture totale, ou ouverture qui rétablit simplement la récurrence du jour) —
 * `null` et `[]` ne sont pas la même chose et le domaine les distingue.
 */
export const poserExceptionSchema = z.object({
  jour: z.iso.date(),
  type: z.enum(['FERMETURE', 'OUVERTURE', 'JOURNEE_PEDAGOGIQUE', 'PONT']),
  libelle: z.string().min(1).max(200),
  services: servicesSchema.optional(),
});

export type PoserExceptionDto = z.infer<typeof poserExceptionSchema>;

/**
 * Saisie d'une période. `source` n'est **pas** dans le corps : cette route est
 * celle du parent, elle pose toujours du `MANUEL`. L'import open data (lot 3) a
 * son propre chemin et c'est lui, et lui seul, qui écrit `IMPORT` — sans quoi un
 * réimport pourrait balayer une saisie manuelle qui s'est déclarée importée.
 */
export const saisirPeriodeSchema = z
  .object({
    type: z.enum(['PERIODE_SCOLAIRE', 'VACANCES', 'FERMETURE_ANNUELLE']),
    libelle: z.string().min(1).max(200),
    du: z.iso.date(),
    au: z.iso.date(),
    anneeScolaire: z
      .string()
      .regex(/^\d{4}-\d{4}$/, 'année scolaire attendue au format 2026-2027')
      .optional(),
  })
  .refine((p) => p.du <= p.au, {
    message: 'la fin de période précède son début',
    path: ['au'],
  });

export type SaisirPeriodeDto = z.infer<typeof saisirPeriodeSchema>;

/** Régime de fériés d'un établissement (`FR` par défaut — D7). */
export const regimeFeriesSchema = z.enum(REGIMES_FERIES);
