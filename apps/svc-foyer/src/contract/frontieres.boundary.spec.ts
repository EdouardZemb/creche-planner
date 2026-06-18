import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { describe, expect, it } from 'vitest';

/**
 * Garde-fou DEC-01/CA2 — segmentation des contrats par contexte.
 *
 * Prouve, de façon déterministe, que la règle `@nx/enforce-module-boundaries`
 * **interdit** à un service d'un contexte de dépendre des contrats d'un contexte
 * qu'il ne consomme pas. Concrètement : `svc-foyer` (`context:foyer`) ne peut PAS
 * importer `@creche-planner/contracts-planification` (`context:planification`).
 *
 * Vérification manuelle reproductible (preuve « live ») : ajouter dans
 * `foyer.service.ts` `import { CONTRAT_CREE_TYPE } from
 * '@creche-planner/contracts-planification';` puis `pnpm nx lint svc-foyer` →
 * échec « A project tagged with "context:foyer" can only depend on libs tagged
 * with "context:foyer", "context:shared" ». Ce test fige la config qui garantit
 * cet échec, sans avoir à booter ESLint.
 *
 * Les contraintes sont désormais portées par le flat config `eslint.config.mjs`
 * (ESLint 9) ; on importe le module et on cherche le bloc qui définit la règle.
 */

// nx lance vitest avec cwd = racine du projet (apps/svc-foyer) → racine du dépôt à ../../.
const RACINE = resolve(process.cwd(), '../..');

interface DepConstraint {
  sourceTag: string;
  onlyDependOnLibsWithTags: string[];
}

interface FlatConfigBloc {
  rules?: {
    '@nx/enforce-module-boundaries'?: [
      string,
      { depConstraints: DepConstraint[] },
    ];
  };
}

async function chargerContraintes(): Promise<DepConstraint[]> {
  const url = pathToFileURL(resolve(RACINE, 'eslint.config.mjs')).href;
  const mod = (await import(url)) as { default: FlatConfigBloc[] };
  for (const bloc of mod.default) {
    const regle = bloc.rules?.['@nx/enforce-module-boundaries'];
    if (regle) {
      return regle[1].depConstraints;
    }
  }
  throw new Error('Règle @nx/enforce-module-boundaries introuvable');
}

async function allowList(tag: string): Promise<string[]> {
  const contrainte = (await chargerContraintes()).find(
    (c) => c.sourceTag === tag,
  );
  if (!contrainte) {
    throw new Error(`Contrainte introuvable pour ${tag}`);
  }
  return contrainte.onlyDependOnLibsWithTags;
}

describe('frontières de contrats (DEC-01/CA2)', () => {
  it('interdit context:foyer → context:planification (import inter-contexte interdit)', async () => {
    expect(await allowList('context:foyer')).not.toContain(
      'context:planification',
    );
    expect(await allowList('context:foyer')).not.toContain(
      'context:referentiel',
    );
  });

  it('autorise context:foyer → context:foyer + context:shared (kernel) uniquement', async () => {
    expect(await allowList('context:foyer')).toEqual(
      expect.arrayContaining(['context:foyer', 'context:shared']),
    );
  });

  it('autorise le consommateur context:tarification à tirer les contrats amont consommés', async () => {
    const tarif = await allowList('context:tarification');
    expect(tarif).toEqual(
      expect.arrayContaining([
        'context:tarification',
        'context:shared',
        'context:foyer',
        'context:referentiel',
        'context:planification',
      ]),
    );
  });

  it('a retiré la contrainte morte type:application (DEC-10)', async () => {
    const tags = (await chargerContraintes()).map((c) => c.sourceTag);
    expect(tags).not.toContain('type:application');
  });
});
