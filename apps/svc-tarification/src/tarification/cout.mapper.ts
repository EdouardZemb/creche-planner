import { z } from 'zod';
import { Duree, Money } from '@creche-planner/shared-kernel';
import {
  BaremeEffortPsu,
  CoutMois,
  GrilleAbcm,
  TarifAlshAbcm,
  TarifCantineAbcm,
  TarifCrechePsu,
  TarifPeriscolaireAbcm,
} from '@creche-planner/tarification-domain';

/**
 * Adaptateur **read-model → domaine** (doc 06 §10.4). Pur, sans réseau ni base :
 * il traduit les lignes projetées (`foyer`, `prestation_mois`) en saisies du
 * domaine `@creche-planner/tarification-domain` et délègue **tout** le calcul aux
 * stratégies (PSU/ABCM). Aucune formule de tarif n'est réimplémentée ici — seul le
 * câblage read-model → `Saisie` vit dans ce fichier (testé à 100 %).
 */

/** Données de foyer nécessaires à la valorisation PSU + à la tranche ABCM. */
export interface FoyerCalcul {
  readonly ressourcesMensuellesCentimes: number;
  readonly nbEnfantsACharge: number;
  readonly tranche: 1 | 2 | 3;
}

/**
 * Paramètres tarifaires **résolus à la date du mois** (SFD 30, D1/D2), fournis par
 * `cout.service` depuis le read-model (repli REST sinon). Le mapper reste pur : il
 * ne fait plus aucune résolution — il reçoit la grille ABCM et/ou le barème PSU
 * déjà résolus. `grille` est requise pour un mode ABCM, `baremePsu` pour la crèche.
 */
export interface ContexteTarif {
  readonly grille?: GrilleAbcm;
  readonly baremePsu?: BaremeEffortPsu;
  readonly plancher?: Money;
  readonly plafond?: Money;
}

/**
 * Schémas des prestations projetées (read model `prestation_mois.prestations`
 * en jsonb, ou repli synchrone Planification). Objets **non stricts**
 * (`looseObject`) : l'amont sérialise des champs supplémentaires
 * (`heuresMensualisees`, `heuresReserveesMinutes`, …) qu'on tolère et
 * transporte sans les exploiter. Les types `Prestation*RM` en sont **inférés**
 * — une seule source de vérité, plus de cast (AQ-03, doc 27).
 */
const prestationCrecheRmSchema = z.looseObject({
  mode: z.literal('CRECHE_PSU'),
  heuresAnnuellesContractualisees: z.number(),
  nbMensualites: z.number(),
  complementMinutes: z.number().optional(),
  heuresDeduitesMinutes: z.number().optional(),
});

const prestationCantineRmSchema = z.looseObject({
  mode: z.literal('CANTINE'),
  nbJours: z.number(),
  pai: z.boolean().optional(),
});

const prestationPeriscolaireRmSchema = z.looseObject({
  mode: z.literal('PERISCOLAIRE'),
  nbMatins: z.number(),
  nbSoirs: z.number(),
});

const prestationAlshRmSchema = z.looseObject({
  mode: z.literal('ALSH'),
  nbJourneesCompletes: z.number(),
  nbDemiJournees: z.number().optional(),
  nbRepas: z.number().optional(),
});

export const prestationRmSchema = z.discriminatedUnion('mode', [
  prestationCrecheRmSchema,
  prestationCantineRmSchema,
  prestationPeriscolaireRmSchema,
  prestationAlshRmSchema,
]);

/** Prestation crèche PSU projetée (durées en minutes, comme sérialisé amont). */
export type PrestationCrecheRM = z.infer<typeof prestationCrecheRmSchema>;
/** Prestation cantine ABCM projetée. */
export type PrestationCantineRM = z.infer<typeof prestationCantineRmSchema>;
/** Prestation périscolaire ABCM projetée. */
export type PrestationPeriscolaireRM = z.infer<
  typeof prestationPeriscolaireRmSchema
>;
/** Prestation ALSH ABCM projetée. */
export type PrestationAlshRM = z.infer<typeof prestationAlshRmSchema>;

/** Union d'une prestation projetée d'un mode. */
export type PrestationRM = z.infer<typeof prestationRmSchema>;

/**
 * Valide une valeur brute (jsonb du read model ou réponse du repli synchrone)
 * en `PrestationRM`. Une non-conformité est un **bug à faire remonter** (donnée
 * de projection corrompue ou contrat amont rompu), pas à masquer : erreur
 * explicite plutôt que cast silencieux (AQ-03, doc 27).
 */
export function parsePrestationRm(valeur: unknown): PrestationRM {
  const resultat = prestationRmSchema.safeParse(valeur);
  if (!resultat.success) {
    throw new Error(
      `prestation projetée invalide (read model corrompu ou contrat amont rompu) : ${z.prettifyError(resultat.error)}`,
    );
  }
  return resultat.data;
}

/**
 * Valorise une prestation projetée en `CoutMois` via la stratégie du mode.
 * - PSU : ressources/effort du foyer + **barème résolu à date** (`contexte`).
 * - ABCM : **grille résolue à date** (`contexte.grille`) ; quantités du read model.
 * Les tarifs viennent tous du `contexte` (Référentiel projeté) — plus aucune valeur
 * figée (RM-30-04).
 */
export function valoriserPrestation(
  prestation: PrestationRM,
  foyer: FoyerCalcul,
  contexte: ContexteTarif,
): CoutMois {
  switch (prestation.mode) {
    case 'CRECHE_PSU':
      return valoriserCreche(prestation, foyer, contexte);
    case 'CANTINE':
      return new TarifCantineAbcm(exigerGrille(contexte)).calculerCoutMois({
        nbJours: prestation.nbJours,
        ...(prestation.pai !== undefined ? { pai: prestation.pai } : {}),
      });
    case 'PERISCOLAIRE':
      return new TarifPeriscolaireAbcm(exigerGrille(contexte)).calculerCoutMois(
        {
          nbMatins: prestation.nbMatins,
          nbSoirs: prestation.nbSoirs,
        },
      );
    case 'ALSH':
      return new TarifAlshAbcm(exigerGrille(contexte)).calculerCoutMois({
        nbJourneesCompletes: prestation.nbJourneesCompletes,
        ...(prestation.nbDemiJournees !== undefined
          ? { nbDemiJournees: prestation.nbDemiJournees }
          : {}),
        ...(prestation.nbRepas !== undefined
          ? { nbRepas: prestation.nbRepas }
          : {}),
      });
  }
}

/** Exige une grille ABCM résolue dans le contexte (garantie par `cout.service`). */
function exigerGrille(contexte: ContexteTarif): GrilleAbcm {
  if (contexte.grille === undefined) {
    throw new Error('grille ABCM non résolue pour cette prestation');
  }
  return contexte.grille;
}

function valoriserCreche(
  prestation: PrestationCrecheRM,
  foyer: FoyerCalcul,
  contexte: ContexteTarif,
): CoutMois {
  if (contexte.baremePsu === undefined) {
    throw new Error('barème PSU non résolu pour cette prestation');
  }
  const tarif = new TarifCrechePsu({
    ressourcesMensuelles: Money.depuisCentimes(
      foyer.ressourcesMensuellesCentimes,
    ),
    nbEnfantsACharge: foyer.nbEnfantsACharge,
    bareme: contexte.baremePsu,
    ...(contexte.plancher !== undefined ? { plancher: contexte.plancher } : {}),
    ...(contexte.plafond !== undefined ? { plafond: contexte.plafond } : {}),
  });
  const complementMinutes = prestation.complementMinutes ?? 0;
  const heuresDeduitesMinutes = prestation.heuresDeduitesMinutes ?? 0;
  return tarif.calculerCoutMois({
    heuresAnnuellesContractualisees: prestation.heuresAnnuellesContractualisees,
    nbMensualites: prestation.nbMensualites,
    ...(complementMinutes > 0
      ? { complement: Duree.depuisMinutes(complementMinutes) }
      : {}),
    // Les heures déduites projetées sont déjà éligibles (filtrées côté Planification) :
    // on les transporte en une absence « déjà éligible » (préavis ≥ 2 j) pour réutiliser
    // la déduction du domaine sans refaire la règle d'éligibilité (INV-08).
    ...(heuresDeduitesMinutes > 0
      ? {
          absences: [
            {
              duree: Duree.depuisMinutes(heuresDeduitesMinutes),
              preavisJours: 2,
              certificatMaladie: false,
            },
          ],
        }
      : {}),
  });
}
