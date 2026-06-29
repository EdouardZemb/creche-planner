import { z } from 'zod';
import {
  extraireSemaine,
  type SnapshotSemaine,
} from '@creche-planner/shared-semaine';
import type {
  ContratVue,
  EtablissementVue,
} from '../clients/planification.client.js';
import { preavisRegleSchema } from './bff.dto.js';

/**
 * Agrégation **pure** de la vue hebdomadaire éditable d'un foyer (lecture seule). À
 * partir des contrats du foyer (avec leur(s) saisie(s) mensuelle(s) déjà lues) et des
 * **établissements réels** du foyer (entité libre, `svc-planification`), produit la
 * vue consolidée d'une semaine : pour chaque contrat actif, ses **besoins datés**
 * restreints aux 7 jours (`extraireSemaine`, lib partagée), rattaché à son
 * établissement par le **lien explicite** `contrat.etablissementId` (P3) — fini le
 * mapping codé `mode → clé`.
 *
 * La récupération des données (contrats, plannings, établissements) reste au
 * contrôleur ; ce module ne fait que transformer — sans I/O, donc testable directement.
 */

/** Modes de garde connus (un mode inconnu côté amont est ignoré défensivement). */
const MODES = ['CRECHE_PSU', 'PERISCOLAIRE', 'CANTINE', 'ALSH'] as const;
type Mode = (typeof MODES)[number];

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

/** Une plage horaire de la semaine-type crèche (planning de base). */
const plageHoraireSchema = z.object({
  debutHeures: z.number(),
  debutMinutes: z.number(),
  finHeures: z.number(),
  finMinutes: z.number(),
});

/**
 * Semaine-type **crèche** : jour de la semaine (`LUNDI`…) → plages horaires gardées.
 * Clé laissée en `string` (lenient) : on ne valide que la forme des valeurs, l'écran
 * indexe par jour. C'est le planning de BASE, affiché pour voir les horaires
 * planifiés sans ouvrir la saisie.
 */
const semaineTypeCrecheSchema = z.record(
  z.string(),
  z.array(plageHoraireSchema),
);

/** Semaine-type **ABCM** : jour d'école → services inscrits (planning de base). */
const semaineAbcmSchema = z.record(
  z.string(),
  z.object({
    cantine: z.boolean().optional(),
    periMatin: z.boolean().optional(),
    periSoir: z.boolean().optional(),
  }),
);

/** Établissement réel concerné par la semaine (entité libre, `svc-planification`). */
const etablissementConcerneSchema = z.object({
  /** Identifiant de l'établissement réel (clé de groupement côté écran). */
  etablissementId: z.string(),
  /** Nom libre de l'établissement (en-tête de groupe). */
  libelle: z.string(),
  /** Règle de préavis, `null` si l'établissement ne l'a pas (encore) renseignée. */
  preavisRegle: preavisRegleSchema.nullable(),
});

/** Un contrat actif de la semaine, avec ses besoins datés et son établissement. */
const contratBesoinsSchema = z.object({
  contratId: z.string(),
  enfant: z.string(),
  mode: z.enum(MODES),
  /** Lien explicite vers l'établissement réel (P3), `null` si non rattaché. */
  etablissementId: z.string().nullable(),
  besoins: besoinsSchema,
  // Planning de BASE (semaine-type) du contrat : l'un OU l'autre selon le mode.
  // Permet à l'écran d'afficher les horaires planifiés d'un jour normal sans entrer
  // dans la saisie (les entrées datées de `besoins` restent les exceptions du jour).
  semaineType: semaineTypeCrecheSchema.optional(),
  semaineAbcm: semaineAbcmSchema.optional(),
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
  // Établissements réellement référencés par un contrat actif (lien explicite) :
  // sert à ne retenir, dans la sortie, que les fiches concernées par la semaine.
  const idsConcernes = new Set<string>();
  const contrats = input.contrats.flatMap(({ contrat, saisies }) => {
    if (!estModeConnu(contrat.mode)) {
      return [];
    }
    // Routage par le **lien explicite** porté par le contrat (P3). `null` = contrat
    // pas (encore) rattaché : il reste affiché mais n'est groupé sous aucun établissement.
    const etablissementId = contrat.etablissementId ?? null;
    if (etablissementId !== null) {
      idsConcernes.add(etablissementId);
    }
    const besoins: SnapshotSemaine = extraireSemaine(saisies, input.jours);
    // La semaine-type (planning de base) transite via le `passthrough` de
    // `listerContrats` ; on la lit défensivement et on ne garde que celle du mode
    // (un parse en échec ⇒ `undefined` ⇒ champ omis, l'écran retombe sur « — »).
    const brut = contrat as unknown as Record<string, unknown>;
    const semaineType =
      contrat.mode === 'CRECHE_PSU'
        ? semaineTypeCrecheSchema.safeParse(brut['semaineType']).data
        : undefined;
    const semaineAbcm =
      contrat.mode === 'CRECHE_PSU'
        ? undefined
        : semaineAbcmSchema.safeParse(brut['semaineAbcm']).data;
    return [
      {
        contratId: contrat.id,
        enfant: contrat.enfant,
        mode: contrat.mode,
        etablissementId,
        besoins,
        ...(semaineType ? { semaineType } : {}),
        ...(semaineAbcm ? { semaineAbcm } : {}),
      },
    ];
  });

  const etablissements = input.annuaire
    .filter((e) => idsConcernes.has(e.id))
    .map((e) => ({
      etablissementId: e.id,
      libelle: e.nom,
      preavisRegle: e.preavisRegle,
    }));

  return semaineBesoinsSchema.parse({
    semaineIso: input.semaineIso,
    jours: [...input.jours],
    etablissements,
    contrats,
  });
}
