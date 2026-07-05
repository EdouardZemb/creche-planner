import { describe, expect, it } from 'vitest';
import { gatewayOpenApiDocument } from '@creche-planner/contracts-kernel';
import type {
  FoyerVue,
  EnfantVue,
  ContratVue,
  Ligne,
  CoutMoisVue,
  CoutAnnuelVue,
  DossierFoyerVue,
  CreerDossierFoyer,
  Mode,
} from '../types/bff';

// Garde DEC-03 / CA2 / AQ-10 : preuve, au niveau type, que les types HTTP du
// front sont bien ceux GÉNÉRÉS depuis le document OpenAPI publié
// (`gatewayOpenApiDocument` → openapi-typescript → `openapi-types.gen.ts`) et
// qu'une **divergence** contrat ↔ usage front casse `web:typecheck`.
//
// Complémentarité avec le job CI `openapi-types-drift` : le job garantit que le
// fichier généré commité est à jour vis-à-vis du contrat ; ce spec garantit que
// les types consommés par le front (façade `types/bff.ts`) sont bien câblés sur
// le fichier généré et gardent la forme attendue.
//
// Mécanique de la preuve :
//   - `Egal<A, B>` n'est `true` que si A et B sont structurellement identiques ;
//     `verifie<Egal<...>>()` ne compile que si le résultat vaut `true` → si les
//     types s'écartent du contrat, l'appel devient une erreur de compilation
//     (donc `web:typecheck` échoue).
//   - Les blocs `@ts-expect-error` exigent qu'une valeur **non conforme** au contrat
//     soit rejetée ; si les types cessaient de contraindre la forme, l'erreur
//     attendue disparaîtrait et `@ts-expect-error` deviendrait lui-même une erreur.

type Egal<A, B> =
  (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2
    ? true
    : false;

// `verifie<E>()` ne compile que si `E` vaut `true` : on l'instancie avec
// `Egal<Genere, FormeContrat>` ; un type généré qui s'écarte du contrat rend
// `E = false`, ce qui casse `web:typecheck`.
function verifie<E extends true>(): E {
  return true as E;
}

describe('openapi-types — types générés depuis le contrat gateway', () => {
  it('les vues générées correspondent aux schemas du contrat (assertions de type)', () => {
    // FoyerVue généré = forme du schema FoyerVue
    verifie<
      Egal<
        FoyerVue,
        {
          id: string;
          ressourcesMensuellesCentimes: number;
          ressourcesMensuellesEuros: number;
          rfrCentimes: number;
          rfrEuros: number;
          nbEnfantsACharge: number;
          nbParts: number;
          tranche: number;
        }
      >
    >();

    // ContratVue : `valideAu` est nullable (type ['string','null'] du contrat) ;
    // `enfantId` est le lien de référence vers l'enfant (svc-foyer), requis et
    // nullable (null = contrat historique pas encore back-fillé) ;
    // `etablissementId` est le lien explicite vers l'établissement (P2/P3),
    // optionnel et nullable (non requis dans le schema).
    verifie<
      Egal<
        ContratVue,
        {
          id: string;
          foyerId: string;
          enfant: string;
          enfantId: string | null;
          mode: string;
          etablissementId?: string | null;
          valideDu: string;
          valideAu: string | null;
        }
      >
    >();

    // Ligne : `sens` est l'union littérale issue de l'enum du contrat
    verifie<
      Egal<
        Ligne,
        {
          libelle: string;
          sens: 'debit' | 'credit';
          montantCentimes: number;
        }
      >
    >();

    // Mode : union littérale issue de l'enum `mode` du requestBody contrats
    verifie<Egal<Mode, 'CRECHE_PSU' | 'CANTINE' | 'PERISCOLAIRE' | 'ALSH'>>();

    expect(true).toBe(true);
  });

  it('un objet conforme au contrat est accepté par les types générés', () => {
    const foyer: FoyerVue = {
      id: gatewayOpenApiDocument.components.schemas.FoyerVue.required[0],
      ressourcesMensuellesCentimes: 100000,
      ressourcesMensuellesEuros: 1000,
      rfrCentimes: 1200000,
      rfrEuros: 12000,
      nbEnfantsACharge: 1,
      nbParts: 2,
      tranche: 2,
    };
    const enfant: EnfantVue = {
      id: 'e1',
      foyerId: foyer.id,
      prenom: 'Lou',
      dateNaissance: '2022-01-01',
    };
    const dossier: DossierFoyerVue = { foyer, enfants: [enfant], parents: [] };
    expect(dossier.enfants[0]?.prenom).toBe('Lou');

    const ligne: Ligne = {
      libelle: 'PSU',
      sens: 'debit',
      montantCentimes: 500,
    };
    const mois: CoutMoisVue = {
      foyerId: foyer.id,
      mois: '2026-01',
      simule: false,
      totalCentimes: 500,
      prestations: [
        {
          enfant: 'Lou',
          mode: 'CRECHE_PSU',
          totalCentimes: 500,
          lignes: [ligne],
        },
      ],
      lignes: [ligne],
    };
    const annee: CoutAnnuelVue = {
      foyerId: foyer.id,
      annee: 2026,
      simule: false,
      totalCentimes: 500,
      mois: [mois],
    };
    const creer: CreerDossierFoyer = {
      ressourcesMensuelles: 1000,
      rfr: 12000,
      nbEnfantsACharge: 1,
      nbParts: 2,
      enfants: [{ prenom: 'Lou', dateNaissance: '2022-01-01' }],
    };
    expect(annee.mois[0]?.totalCentimes).toBe(500);
    expect(creer.enfants).toHaveLength(1);
  });

  it('une divergence contrat ↔ usage front est rejetée par le typage (DEC-03/CA2)', () => {
    // Chaque @ts-expect-error PROUVE qu'une forme non conforme au contrat généré
    // est refusée. Si les types cessaient de refléter le contrat, l'erreur
    // attendue disparaîtrait et `tsc` signalerait un `@ts-expect-error` inutile,
    // faisant échouer `web:typecheck`.

    // @ts-expect-error — `tranche` requis (required du schema) : objet incomplet refusé
    const sansTranche: FoyerVue = {
      id: 'x',
      ressourcesMensuellesCentimes: 1,
      ressourcesMensuellesEuros: 1,
      rfrCentimes: 1,
      rfrEuros: 1,
      nbEnfantsACharge: 1,
      nbParts: 1,
    };
    void sansTranche;

    const ligneInvalide: Ligne = {
      libelle: 'x',
      // @ts-expect-error — `sens` est l'enum {debit|credit} : valeur hors-enum refusée
      sens: 'INCONNU',
      montantCentimes: 1,
    };
    void ligneInvalide;

    // @ts-expect-error — `mois` (CoutMoisVue) doit être un objet contrat, pas un number
    const moisInvalide: CoutMoisVue = 42;
    void moisInvalide;

    // @ts-expect-error — `enfants` requis dans le requestBody de création de foyer
    const creerSansEnfants: CreerDossierFoyer = {
      ressourcesMensuelles: 1,
      rfr: 1,
      nbEnfantsACharge: 1,
      nbParts: 1,
    };
    void creerSansEnfants;

    expect(true).toBe(true);
  });
});
