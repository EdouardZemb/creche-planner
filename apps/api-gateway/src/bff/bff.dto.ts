import { BadRequestException } from '@nestjs/common';
import { z } from 'zod';
import { MODES_CONTRAT } from '@creche-planner/contracts-kernel';

/**
 * Schémas de validation des **entrées de la gateway** (frontière BFF). La
 * validation métier profonde reste chez le service propriétaire ; ici on vérifie
 * la forme minimale et on relaie. Les erreurs sont rendues au même format que les
 * services amont : `[{ champ, message }]`.
 */

/**
 * Rattachement d'un parent au foyer (frontière BFF). `email` requis ; le reste
 * est une identité douce optionnelle. La validation profonde (unicité, défauts
 * `principal`/`ordre`) reste chez `svc-foyer`.
 */
export const ajouterParentSchema = z.object({
  email: z.email('adresse e-mail invalide'),
  prenom: z.string().min(1).max(200).optional(),
  nom: z.string().min(1).max(200).optional(),
  principal: z.boolean().optional(),
  ordre: z.number().int().min(0).optional(),
});

/**
 * Édition d'un parent (`PUT`) : tous les champs optionnels (upsert partiel) ;
 * `prenom`/`nom` acceptent `null` pour effacer l'identité douce, `actif` réactive
 * un parent retiré (soft-delete).
 */
export const modifierParentSchema = z.object({
  email: z.email('adresse e-mail invalide').optional(),
  prenom: z.string().min(1).max(200).nullable().optional(),
  nom: z.string().min(1).max(200).nullable().optional(),
  principal: z.boolean().optional(),
  ordre: z.number().int().min(0).optional(),
  actif: z.boolean().optional(),
});

/**
 * Rattachement d'un enfant au foyer (frontière BFF) : prénom + date de naissance.
 * Sert l'ajout d'un enfant à un foyer existant (`POST /foyers/:id/enfants`) et,
 * réutilisé, les enfants de la création orchestrée. La validation profonde reste
 * chez `svc-foyer`.
 */
export const ajouterEnfantSchema = z.object({
  prenom: z.string().min(1),
  dateNaissance: z.string().min(1),
});

/**
 * Édition d'un enfant (`PUT /foyers/:id/enfants/:enfantId`) : même forme minimale
 * que l'ajout (prénom + date) ; la validation profonde reste chez `svc-foyer`.
 */
export const modifierEnfantSchema = ajouterEnfantSchema;

/** Création orchestrée d'un foyer + ses enfants + ses parents. */
export const creerDossierFoyerSchema = z.object({
  ressourcesMensuelles: z.number().nonnegative(),
  rfr: z.number().nonnegative(),
  nbEnfantsACharge: z.number().int().min(1),
  nbParts: z.number().positive(),
  // Date d'effet de la **première** version de ressources (SFD 30, DV-03) :
  // optionnelle, défaut aujourd'hui côté `svc-foyer`. Elle manquait ici alors que
  // `svc-foyer.creer` l'accepte depuis SFD 30 et que l'édition la porte — un
  // dossier ne pouvait donc naître qu'avec un historique commençant **le jour de
  // la saisie**. Sans conséquence tant que l'aval extrapolait ; depuis `AM-55` il
  // refuse, et une famille qui remplit son dossier en octobre pour une rentrée de
  // septembre ne pouvait plus voir septembre.
  dateEffet: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, 'date ISO YYYY-MM-DD attendue')
    .optional(),
  motif: z.string().min(1).max(500).optional(),
  enfants: z.array(ajouterEnfantSchema).default([]),
  parents: z.array(ajouterParentSchema).default([]),
});
export type CreerDossierFoyer = z.infer<typeof creerDossierFoyerSchema>;

/**
 * Édition des **scalaires** d'un foyer (`PUT /foyers/:id`) : mêmes champs que la
 * création **sans** `enfants`/`parents` (sous-ressources gérées via leurs propres
 * routes). La validation profonde reste chez `svc-foyer`.
 *
 * « Mêmes champs que la création » était **faux** jusqu'au 2026-08-16 : seule
 * l'édition portait `dateEffet`/`motif`, et rien ne confrontait les deux schémas.
 * Les tenir alignés est la raison d'être de ce commentaire — s'ils divergent, la
 * ligne à corriger est celle-ci autant que le code.
 */
export const ecrireFoyerScalairesSchema = z.object({
  ressourcesMensuelles: z.number().nonnegative(),
  rfr: z.number().nonnegative(),
  nbEnfantsACharge: z.number().int().min(1),
  nbParts: z.number().positive(),
  // Date d'effet des ressources (SFD 30, DV-03) : optionnelle, défaut aujourd'hui
  // côté svc-foyer — une saisie sans cette date reste valide (rétrocompatible).
  dateEffet: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, 'date ISO YYYY-MM-DD attendue')
    .optional(),
  motif: z.string().min(1).max(500).optional(),
});
export type EcrireFoyerScalaires = z.infer<typeof ecrireFoyerScalairesSchema>;

/**
 * Création d'un contrat de garde. Champs communs validés ; les champs
 * spécifiques au mode (`semaineType`, `semaineAbcm`, `heuresAnnuelles…`) passent
 * via `passthrough()` et sont validés par `svc-planification`.
 */
export const creerContratSchema = z
  .object({
    mode: z.enum(MODES_CONTRAT),
    foyerId: z.string().min(1),
    // Prénom dénormalisé (affichage) + lien de référence vers l'enfant (svc-foyer).
    enfant: z.string().min(1),
    enfantId: z.string().min(1),
    valideDu: z.string().min(1),
    valideAu: z.string().nullable(),
  })
  .passthrough();

/**
 * Modification (correction de la version courante) d'un contrat de garde : mêmes
 * champs communs que la création ; les champs spécifiques au mode passent via
 * `passthrough()` et sont validés en amont. Depuis le lot 4 (SFD 30), le relais
 * vise `PUT /contrats/:id/version-courante` côté service — **non destructif** (les
 * plannings saisis survivent) et limité aux paramètres versionnés (H6).
 */
export const modifierContratSchema = creerContratSchema;

/**
 * **Avenant** (SFD 30 lot 4) : nouvelle version d'un contrat à date d'effet. Forme
 * minimale à la frontière (mode + dateEffet) ; les paramètres versionnés
 * (`semaineType`/`semaineAbcm`, heures, mensualités, motif) passent via
 * `passthrough()` et sont validés par `svc-planification`.
 */
export const creerAvenantSchema = z
  .object({
    mode: z.enum(['CRECHE_PSU', 'CANTINE', 'PERISCOLAIRE', 'ALSH']),
    dateEffet: z.string().min(1),
  })
  .passthrough();

/**
 * **Correction** d'une version existante (SFD 30 lot 4) : mêmes paramètres
 * versionnés que l'avenant, sans `dateEffet` (la version garde sa date).
 */
export const corrigerVersionSchema = z
  .object({
    mode: z.enum(['CRECHE_PSU', 'CANTINE', 'PERISCOLAIRE', 'ALSH']),
  })
  .passthrough();

/** Corps d'écriture de planning : relayé tel quel au service propriétaire. */
export const ecrirePlanningSchema = z.object({}).passthrough();

// Enums de notification inlinés à la frontière BFF (comme `MODES_ETABLISSEMENT`) :
// la source de vérité reste `contracts-foyer` ; on évite une arête de dépendance
// vers la lib de contrats pour une simple validation de forme. La validation
// profonde (invariant « ≥ 1 canal actif ») reste chez `svc-foyer`.
const TYPES_NOTIFICATION = ['VALIDATION_HEBDO', 'RECAP_SERVICE'] as const;
const CANAUX = ['EMAIL', 'IN_APP'] as const;

/**
 * Mise à jour des **préférences de notification** du parent courant
 * (`PUT /moi/preferences`). Liste non vide des choix explicites `(type, canal,
 * actif)` ; le `parentId`/`foyerId` sont résolus **côté serveur** depuis
 * l'identité (jamais fournis par le client). La validation profonde reste amont.
 */
export const majPreferencesSchema = z.object({
  preferences: z
    .array(
      z.object({
        typeNotification: z.enum(TYPES_NOTIFICATION),
        canal: z.enum(CANAUX),
        actif: z.boolean(),
      }),
    )
    .min(1, 'au moins une préférence attendue'),
});
export type MajPreferences = z.infer<typeof majPreferencesSchema>;

// Semaine ISO `YYYY-Www` (01-53). La validation profonde reste au service.
const SEMAINE_ISO = /^\d{4}-W(0[1-9]|[1-4]\d|5[0-3])$/;
/** Semaine ISO au format `YYYY-Www`. */
export const semaineIsoSchema = z
  .string()
  .regex(SEMAINE_ISO, 'semaine attendue au format YYYY-Www');

/** Heure du jour `HH:MM` (00:00 → 23:59), pour la règle de préavis « jour + heure ». */
const HEURE = /^([01]\d|2[0-3]):[0-5]\d$/;

/**
 * Règle de préavis d'un établissement (union discriminée par `type`) — forme
 * minimale validée à la frontière BFF, la validation profonde reste au service.
 */
export const preavisRegleSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('JOURS_OUVRES'),
    valeur: z.number().int().min(0).max(30),
  }),
  z.object({
    type: z.literal('JOUR_HEURE'),
    jour: z.enum([
      'LUNDI',
      'MARDI',
      'MERCREDI',
      'JEUDI',
      'VENDREDI',
      'SAMEDI',
      'DIMANCHE',
    ]),
    heure: z.string().regex(HEURE, 'heure attendue au format HH:MM'),
  }),
]);

/**
 * Régimes de jours fériés d'un établissement — miroir de `REGIMES_FERIES`
 * (`shared-kernel`). Déclaré **avant** les schémas qui l'emploient : un `z.enum`
 * s'évalue à l'initialisation du module, une `const` posée plus bas serait dans sa
 * zone morte temporelle.
 */
const REGIMES_FERIES_BFF = ['FR', 'FR_ALSACE_MOSELLE'] as const;

/** Modes de garde proposables par un établissement (sous-ensemble informatif). */
const MODES_ETABLISSEMENT = [
  'CRECHE_PSU',
  'PERISCOLAIRE',
  'CANTINE',
  'ALSH',
] as const;

/**
 * Création d'un **établissement** (entité libre par foyer, P2) à la frontière BFF
 * — relayé à `svc-planification` qui fait la validation profonde. Seul `nom` est
 * requis ; le reste est facultatif et peut être `null` (champ vidé). Le `foyerId`
 * voyage dans le chemin (`/foyers/:foyerId/etablissements`), pas dans le corps.
 */
export const creerEtablissementSchema = z.object({
  nom: z.string().min(1).max(200),
  emailService: z.email('adresse e-mail invalide').nullish(),
  preavisRegle: preavisRegleSchema.nullish(),
  types: z.array(z.enum(MODES_ETABLISSEMENT)).optional(),
  adresse: z.string().max(500).nullish(),
  telephone: z.string().max(40).nullish(),
  contact: z.string().max(200).nullish(),
  actif: z.boolean().optional(),
  /** Zone de vacances scolaires (SFD 31), `null` = pas de calendrier scolaire. */
  zoneScolaire: z.enum(['A', 'B', 'C']).nullish(),
  /** Régime de fériés (`FR` par défaut, `FR_ALSACE_MOSELLE` pour Mulhouse). */
  regimeFeries: z.enum(REGIMES_FERIES_BFF).optional(),
});

/** Édition d'un établissement : tous les champs facultatifs (seuls les fournis changent). */
export const modifierEtablissementSchema = creerEtablissementSchema.partial();

/**
 * ## Calendrier d'ouverture (SFD 31, lot 2) — frontière BFF
 *
 * La validation profonde reste chez `svc-planification` ; ce qui se joue ici est
 * la **forme**, et surtout la traversée de `aLaDate`. Ce paramètre franchit quatre
 * couches (route amont → BFF → ce schéma → client web) et un `z.object` **strippe
 * silencieusement** toute clé qu'il ne déclare pas : l'oublier à cette étape-ci ne
 * produit aucune erreur, seulement une réponse résolue au mauvais instant
 * (`LE-48`). Il est donc déclaré explicitement, et un test le vérifie de bout en
 * bout plutôt que de le supposer.
 *
 * Un service ouvrable par le calendrier est un mode du catalogue — même liste que
 * les types d'établissement, réutilisée telle quelle.
 */
const serviceCalendrierSchema = z.enum(MODES_ETABLISSEMENT);

/** Query de la lecture résolue : plage métier + instant de connaissance. */
export const lireCalendrierQuerySchema = z.object({
  du: z.iso.date(),
  au: z.iso.date(),
  aLaDate: z.string().min(1).optional(),
});

/** Query des couches brutes : l'instant de connaissance seul. */
export const lireCoucheCalendrierQuerySchema = z.object({
  aLaDate: z.string().min(1).optional(),
});

/** Remplacement intégral de la récurrence hebdomadaire. */
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
      services: z.array(serviceCalendrierSchema),
    }),
  ),
});

/** Pose d'une exception ponctuelle (`services` omis = tous les services). */
export const poserExceptionSchema = z.object({
  jour: z.iso.date(),
  type: z.enum(['FERMETURE', 'OUVERTURE', 'JOURNEE_PEDAGOGIQUE', 'PONT']),
  libelle: z.string().min(1).max(200),
  services: z.array(serviceCalendrierSchema).optional(),
});

/** Saisie d'une période (`source` n'est pas dans le corps : toujours `MANUEL`). */
export const saisirPeriodeSchema = z.object({
  type: z.enum(['PERIODE_SCOLAIRE', 'VACANCES', 'FERMETURE_ANNUELLE']),
  libelle: z.string().min(1).max(200),
  du: z.iso.date(),
  au: z.iso.date(),
  anneeScolaire: z
    .string()
    .regex(/^\d{4}-\d{4}$/, 'année scolaire attendue au format 2026-2027')
    .optional(),
});

// Mois borné 01-12 (AQ-04, doc 27 : l'ancienne `\d{2}` acceptait « 2026-13 »).
const MOIS = /^\d{4}-(0[1-9]|1[0-2])$/;
/** Mois au format `YYYY-MM`. */
export const moisSchema = z
  .string()
  .regex(MOIS, 'mois attendu au format YYYY-MM');

/**
 * Valide `valeur` contre `schema` ou lève une `BadRequestException` (400) au
 * format `[{ champ, message }]`, homogène avec les services amont.
 */
export function valider<T>(schema: z.ZodType<T>, valeur: unknown): T {
  const resultat = schema.safeParse(valeur);
  if (!resultat.success) {
    throw new BadRequestException(
      resultat.error.issues.map((probleme) => ({
        champ: probleme.path.join('.'),
        message: probleme.message,
      })),
    );
  }
  return resultat.data;
}
