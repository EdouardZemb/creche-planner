import { z } from 'zod';
import {
  extraireSemaine,
  type SnapshotSemaine,
} from '@creche-planner/shared-semaine';
import type { ContratVue } from '../clients/planification.client.js';
import type { EtablissementVue } from '../clients/notifications.client.js';
import { CLES_ETABLISSEMENT, preavisRegleSchema } from './bff.dto.js';

/**
 * Agrégation **pure** de la vue hebdomadaire éditable d'un foyer (lecture seule). À
 * partir des contrats du foyer (avec leur(s) saisie(s) mensuelle(s) déjà lues) et de
 * l'annuaire des établissements, produit la vue consolidée d'une semaine : pour
 * chaque contrat actif, ses **besoins datés** restreints aux 7 jours
 * (`extraireSemaine`, lib partagée), rattaché à son établissement destinataire.
 *
 * La récupération des données (contrats, plannings, annuaire) reste au contrôleur ;
 * ce module ne fait que transformer — sans I/O, donc testable directement.
 */

/** Modes de garde connus (un mode inconnu côté amont est ignoré défensivement). */
const MODES = ['CRECHE_PSU', 'PERISCOLAIRE', 'CANTINE', 'ALSH'] as const;
type Mode = (typeof MODES)[number];

/** Clé d'établissement destinataire (annuaire `svc-notifications`). */
type CleEtablissement = (typeof CLES_ETABLISSEMENT)[number];

/**
 * Mapping `mode de garde → clé d'établissement`, recalculé côté gateway (le plan
 * autorise à ne pas dépendre de `svc-notifications` pour cette résolution simple) :
 * `CRECHE_PSU` → crèche des Hirondelles ; `PERISCOLAIRE`/`CANTINE`/`ALSH` → ABCM.
 */
const MODE_VERS_CLE: Readonly<Record<Mode, CleEtablissement>> = {
  CRECHE_PSU: 'CRECHE_HIRONDELLES',
  PERISCOLAIRE: 'ABCM',
  CANTINE: 'ABCM',
  ALSH: 'ABCM',
};

function estModeConnu(mode: string): mode is Mode {
  return (MODES as readonly string[]).includes(mode);
}

// ---- DTO de sortie (Zod) ----------------------------------------------------

/** Entrées datées d'un jour (mêmes catégories que la saisie mensuelle). */
const saisieJourSchema = z.object({
  joursSupplementaires: z.array(z.unknown()),
  absences: z.array(z.unknown()),
  exceptions: z.array(z.unknown()),
  joursAlsh: z.array(z.unknown()),
});

/** Besoins de la semaine d'un contrat : jour `YYYY-MM-DD` → entrées (jours vides omis). */
const besoinsSchema = z.record(z.string(), saisieJourSchema);

/** Établissement destinataire concerné par la semaine (annuaire). */
const etablissementConcerneSchema = z.object({
  cle: z.enum(CLES_ETABLISSEMENT),
  libelle: z.string(),
  preavisRegle: preavisRegleSchema,
});

/** Un contrat actif de la semaine, avec ses besoins datés et son établissement. */
const contratBesoinsSchema = z.object({
  contratId: z.string(),
  enfant: z.string(),
  mode: z.enum(MODES),
  etablissementCle: z.enum(CLES_ETABLISSEMENT),
  besoins: besoinsSchema,
});

/**
 * Vue consolidée d'une semaine éditable du foyer : les 7 jours, les établissements
 * concernés (récap mail par établissement, phase ultérieure) et les contrats actifs
 * avec leurs besoins datés, groupables côté écran par enfant → établissement/mode.
 */
export const semaineBesoinsSchema = z.object({
  semaineIso: z.string(),
  jours: z.array(z.string()),
  etablissements: z.array(etablissementConcerneSchema),
  contrats: z.array(contratBesoinsSchema),
});

export type SemaineBesoinsVue = z.infer<typeof semaineBesoinsSchema>;

// ---- Logique pure -----------------------------------------------------------

/**
 * Vrai si la période de validité du contrat **chevauche** la semaine. Mêmes bornes
 * que le scheduler de notification (`valide_du ≤ dimanche ET (valide_au null OU
 * valide_au ≥ lundi)`), en comparaison lexicographique sûre sur des dates ISO.
 */
export function estContratActifSurSemaine(
  contrat: { readonly valideDu: string; readonly valideAu: string | null },
  jours: readonly string[],
): boolean {
  const lundi = jours[0];
  const dimanche = jours[jours.length - 1];
  if (lundi === undefined || dimanche === undefined) {
    return false;
  }
  return (
    contrat.valideDu <= dimanche &&
    (contrat.valideAu === null || contrat.valideAu >= lundi)
  );
}

/** Un contrat du foyer avec sa/ses saisie(s) mensuelle(s) déjà lue(s). */
export interface ContratAvecSaisies {
  readonly contrat: ContratVue;
  readonly saisies: readonly (Record<string, unknown> | null)[];
}

/**
 * Construit la vue consolidée. Les contrats passés sont supposés **déjà filtrés
 * actifs** sur la semaine (le contrôleur n'a lu les plannings que pour ceux-là).
 */
export function agregerSemaineBesoins(input: {
  readonly semaineIso: string;
  readonly jours: readonly string[];
  readonly contrats: readonly ContratAvecSaisies[];
  readonly annuaire: readonly EtablissementVue[];
}): SemaineBesoinsVue {
  const clesConcernees = new Set<CleEtablissement>();
  const contrats = input.contrats.flatMap(({ contrat, saisies }) => {
    if (!estModeConnu(contrat.mode)) {
      return [];
    }
    const etablissementCle = MODE_VERS_CLE[contrat.mode];
    clesConcernees.add(etablissementCle);
    const besoins: SnapshotSemaine = extraireSemaine(saisies, input.jours);
    return [
      {
        contratId: contrat.id,
        enfant: contrat.enfant,
        mode: contrat.mode,
        etablissementCle,
        besoins,
      },
    ];
  });

  const etablissements = input.annuaire
    .filter((e) => clesConcernees.has(e.cle))
    .map((e) => ({
      cle: e.cle,
      libelle: e.libelle,
      preavisRegle: e.preavisRegle,
    }));

  return semaineBesoinsSchema.parse({
    semaineIso: input.semaineIso,
    jours: [...input.jours],
    etablissements,
    contrats,
  });
}
