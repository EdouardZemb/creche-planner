import { z } from 'zod';

/**
 * Règle de **préavis** d'un établissement, schéma **canonique partagé** du bounded
 * context Planification. Déplacé ici (depuis le DTO de `svc-notifications`, qui en
 * détenait l'unique copie) pour être réemployé par `svc-planification` (entité
 * `etablissement`, P1) sans en faire une 3ᵉ copie. Les anciennes copies notif/BFF
 * seront pointées vers ce schéma lors du démantèlement (P3/P6) ; elles ne sont pas
 * touchées en P1.
 */

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
export type JourSemaine = (typeof JOURS_SEMAINE)[number];

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
export type PreavisRegle = z.infer<typeof preavisRegleSchema>;
