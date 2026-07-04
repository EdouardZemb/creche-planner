import {
  BadRequestException,
  Injectable,
  type PipeTransform,
} from '@nestjs/common';
import { z, type ZodType } from 'zod';
import { creerEtablissementSchema } from '../etablissement/etablissement.dto.js';

// Dates jour : `z.iso.date()` (calendrier réel — AQ-04, doc 27). Mois : regex
// bornée 01-12 (l'ancienne `\d{2}` acceptait « 2026-13 »).
const ISO_MOIS = /^\d{4}-(0[1-9]|1[0-2])$/;

/** Une plage horaire d'un jour de la semaine type crèche (heures/minutes). */
const plageHoraireSchema = z.object({
  debutHeures: z.number().int().min(0).max(23),
  debutMinutes: z.number().int().min(0).max(59),
  finHeures: z.number().int().min(0).max(24),
  finMinutes: z.number().int().min(0).max(59),
});

const jourSemaineSchema = z.enum([
  'LUNDI',
  'MARDI',
  'MERCREDI',
  'JEUDI',
  'VENDREDI',
  'SAMEDI',
  'DIMANCHE',
]);

/** Semaine type crèche : jour → plages horaires. */
const semaineTypeSchema = z.record(
  jourSemaineSchema,
  z.array(plageHoraireSchema),
);

/** Type de présence ALSH (journée complète ou demi-journée). */
const typeAlshSchema = z.enum(['COMPLETE', 'DEMI']);

/** Inscription ALSH récurrente d'un jour de semaine (formule + repas). */
const jourAlshHebdoSchema = z.object({
  type: typeAlshSchema,
  repas: z.boolean().optional(),
});

/** Inscriptions ABCM d'un jour d'école. */
const inscriptionsJourSchema = z.object({
  cantine: z.boolean().optional(),
  periMatin: z.boolean().optional(),
  periSoir: z.boolean().optional(),
  alsh: jourAlshHebdoSchema.optional(),
});

/** Semaine type ABCM : jour d'école → inscriptions. */
const semaineAbcmSchema = z.record(jourSemaineSchema, inscriptionsJourSchema);

/**
 * Lien **établissement** d'un contrat (P2) : on rattache SOIT un établissement
 * existant par son `etablissementId`, SOIT un `nouvelEtablissement` créé à la volée
 * (dans la même transaction que le contrat — atomicité côté service). Les deux champs
 * sont optionnels **individuellement** mais le refine plus bas exige d'en fournir
 * **exactement un** : depuis P5 (`etablissement_id` NOT NULL) un contrat **doit**
 * être rattaché à un établissement. Le `mode` reste une dimension indépendante
 * (type/tarif), pas l'établissement.
 */
const lienEtablissementChamps = {
  etablissementId: z.string().uuid().optional(),
  nouvelEtablissement: creerEtablissementSchema.optional(),
};

/** Création d'un contrat crèche PSU. */
const creerContratCrecheSchema = z.object({
  mode: z.literal('CRECHE_PSU'),
  foyerId: z.string().uuid(),
  enfant: z.string().min(1),
  valideDu: z.iso.date('date ISO YYYY-MM-DD attendue'),
  valideAu: z.iso.date('date ISO YYYY-MM-DD attendue').nullable(),
  heuresAnnuellesContractualisees: z.number().nonnegative(),
  nbMensualites: z.number().int().min(1),
  semaineType: semaineTypeSchema,
  ...lienEtablissementChamps,
});

/** Création d'un contrat ABCM (cantine / périscolaire / ALSH). */
const creerContratAbcmSchema = z.object({
  mode: z.enum(['CANTINE', 'PERISCOLAIRE', 'ALSH']),
  foyerId: z.string().uuid(),
  enfant: z.string().min(1),
  valideDu: z.iso.date('date ISO YYYY-MM-DD attendue'),
  valideAu: z.iso.date('date ISO YYYY-MM-DD attendue').nullable(),
  semaineAbcm: semaineAbcmSchema,
  ...lienEtablissementChamps,
});

/**
 * Garde « SOIT existant, SOIT nouveau » : exige **exactement un** des deux liens
 * d'établissement (ni zéro — un contrat doit être rattaché depuis P5 — ni les deux).
 */
const lienEtablissementValide = (d: {
  etablissementId?: string | undefined;
  nouvelEtablissement?: unknown;
}): boolean =>
  (d.etablissementId !== undefined) !== (d.nouvelEtablissement !== undefined);
const messageLienValide = {
  message:
    'fournir exactement un établissement : soit etablissementId (existant) soit nouvelEtablissement (création)',
  path: ['etablissementId'],
};

/** Création d'un contrat de garde (crèche PSU ou ABCM). */
export const creerContratSchema = z
  .discriminatedUnion('mode', [
    creerContratCrecheSchema,
    creerContratAbcmSchema,
  ])
  .refine(lienEtablissementValide, messageLienValide);
export type CreerContratDto = z.infer<typeof creerContratSchema>;

/**
 * Modification d'un contrat de garde : mêmes champs que la création (le mode peut
 * changer ; `foyerId` est conservé/réaffirmé). On réutilise la même union par mode.
 */
export const modifierContratSchema = creerContratSchema;
export type ModifierContratDto = z.infer<typeof modifierContratSchema>;

/**
 * Rattachement **chirurgical** d'un contrat existant à un établissement de son
 * foyer (lien P2), pour le **back-fill P5** : ne porte QUE l'`etablissementId`, ne
 * remplace ni le mode/les dates ni la semaine type et **n'invalide pas** les
 * plannings saisis — à la différence de `modifierContratSchema` (remplacement
 * complet via le chemin `PUT /contrats/:id`).
 */
export const rattacherEtablissementSchema = z.object({
  etablissementId: z.string().uuid(),
});
export type RattacherEtablissementDto = z.infer<
  typeof rattacherEtablissementSchema
>;

/**
 * Absence crèche du mois (candidate à déduction PSU). La fenêtre d'absence est
 * saisie en heures d'arrivée/départ (plage horaire) ; la durée déduite en est
 * dérivée (fin − début).
 */
const absenceCrecheSchema = plageHoraireSchema.extend({
  /** Date ISO du jour retiré (métadonnée d'affichage/persistance, optionnelle). */
  date: z.iso.date('date ISO YYYY-MM-DD attendue').optional(),
  preavisJours: z.number().int().min(0),
  certificatMaladie: z.boolean(),
});

/**
 * Un jour de garde ajouté ponctuellement hors semaine type (crèche), saisi en
 * heures d'arrivée/départ (plage horaire) ; la durée s'en déduit.
 */
const jourSupplementaireSchema = plageHoraireSchema.extend({
  date: z.iso.date('date ISO YYYY-MM-DD attendue'),
});

/** Ajustement ponctuel d'un jour ABCM (surcharge la semaine type pour une date). */
const exceptionAbcmSchema = z.object({
  date: z.iso.date('date ISO YYYY-MM-DD attendue'),
  cantine: z.boolean().optional(),
  periMatin: z.boolean().optional(),
  periSoir: z.boolean().optional(),
  // ALSH : retire (false) ou ajoute (true) un jour de la récurrence hebdomadaire.
  alsh: z.boolean().optional(),
});

/** Un jour ALSH réservé. */
const jourAlshSchema = z.object({
  date: z.iso.date('date ISO YYYY-MM-DD attendue'),
  type: typeAlshSchema,
  repas: z.boolean().optional(),
});

/**
 * Saisie d'un planning mensuel : paramètres dépendants du mode (complément et
 * absences pour la crèche, PAI pour la cantine, jours pour l'ALSH). Les jours non
 * facturables ne sont PAS saisis : ils sont récupérés du Référentiel à la lecture.
 */
export const ecrirePlanningSchema = z.object({
  /** Dépassement horaire du mois (crèche), en minutes. */
  complementMinutes: z.number().int().min(0).optional(),
  /** Jours ajoutés ponctuellement hors semaine type (crèche) → complément. */
  joursSupplementaires: z.array(jourSupplementaireSchema).optional(),
  /** Absences du mois (crèche). */
  absences: z.array(absenceCrecheSchema).optional(),
  /** Cas PAI panier-repas (cantine). */
  pai: z.boolean().optional(),
  /** Ajustements ponctuels par jour (cantine / périscolaire). */
  exceptions: z.array(exceptionAbcmSchema).optional(),
  /** Jours ALSH réservés du mois (ALSH). */
  joursAlsh: z.array(jourAlshSchema).optional(),
});
export type EcrirePlanningDto = z.infer<typeof ecrirePlanningSchema>;

/**
 * Corps d'une **édition hebdomadaire** : uniquement les catégories **datées** d'un
 * contrat pour la semaine éditée. Les scalaires mensuels (`complementMinutes`,
 * `pai`) ne sont **pas** rattachables à un jour → hors périmètre d'une édition de
 * semaine (la fusion ne les touche pas, cf. `fusionnerSemaineDansMois`). Réutilise
 * les mêmes schémas d'items que `ecrirePlanningSchema`.
 */
export const ecrireSemaineSchema = z.object({
  joursSupplementaires: z.array(jourSupplementaireSchema).optional(),
  absences: z.array(absenceCrecheSchema).optional(),
  exceptions: z.array(exceptionAbcmSchema).optional(),
  joursAlsh: z.array(jourAlshSchema).optional(),
});
export type EcrireSemaineDto = z.infer<typeof ecrireSemaineSchema>;

export { ISO_MOIS };

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
