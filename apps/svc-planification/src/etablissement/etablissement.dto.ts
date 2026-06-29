import { z } from 'zod';
import {
  MODES_CONTRAT,
  preavisRegleSchema,
} from '@creche-planner/contracts-planification';

/**
 * Liste des **types** proposés par un établissement : sous-ensemble (possiblement
 * vide) des modes de garde, purement informatif (un même établissement peut faire
 * crèche *et* cantine *et* périscolaire…). N'a pas d'incidence sur le mode/tarif
 * d'un contrat, qui reste indépendant.
 */
export const typesEtablissementSchema = z.array(z.enum(MODES_CONTRAT));

/**
 * Corps de **création** d'un établissement (`POST /etablissements?foyer=`). Le
 * `foyerId` voyage en query (portée par foyer), pas dans le corps. Seul `nom` est
 * requis ; e-mail de service, règle de préavis et coordonnées sont facultatifs et
 * peuvent être `null` (champ vidé). `types` défaut `[]`, `actif` défaut `true`.
 */
export const creerEtablissementSchema = z.object({
  nom: z.string().min(1).max(200),
  emailService: z.email('adresse e-mail invalide').nullish(),
  preavisRegle: preavisRegleSchema.nullish(),
  types: typesEtablissementSchema.optional(),
  adresse: z.string().max(500).nullish(),
  telephone: z.string().max(40).nullish(),
  contact: z.string().max(200).nullish(),
  actif: z.boolean().optional(),
});
export type CreerEtablissementDto = z.infer<typeof creerEtablissementSchema>;

/**
 * Corps de **modification** (`PUT /etablissements/:id`) : tous les champs sont
 * facultatifs, seuls les champs **fournis** sont mis à jour (un champ absent reste
 * inchangé ; un champ à `null` vide la valeur). `nom` non vide s'il est fourni.
 */
export const modifierEtablissementSchema = creerEtablissementSchema.partial();
export type ModifierEtablissementDto = z.infer<
  typeof modifierEtablissementSchema
>;
