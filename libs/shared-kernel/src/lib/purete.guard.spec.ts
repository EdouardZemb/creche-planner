import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Garde-fou de **pureté du `shared-kernel`** (DEC-07). Le kernel est le hub du
 * graphe (`fan-in` élevé) ; pour le discipliner sans le fragmenter (ADR-0004) on
 * vérifie automatiquement qu'il ne contient que des **value objects purs**
 * (`Money`, `Duree`, `Tranche`, `DomainError`) :
 *
 * - **CA1** : zéro import de framework / de logique applicative — seuls les
 *   imports **relatifs** internes sont autorisés (`./x.js`). Tout import de
 *   paquet (NestJS, zod, OTel, un autre `@creche-planner/*`, …) fait échouer le
 *   test → on bloque l'introduction de dépendances avant qu'elles n'atteignent
 *   le hub.
 * - **CA2** : `fan-out = 0` — le `package.json` ne déclare **aucune** dépendance
 *   runtime hormis `tslib` (helper d'émission TS, pas une dépendance métier).
 *
 * Ce test scrute la **source** elle-même : il échoue dès qu'un `import` non
 * relatif ou une dépendance est introduit, indépendamment de la règle ESLint.
 */

const ICI = dirname(fileURLToPath(import.meta.url));
const RACINE_LIB = join(ICI, '..', '..');
const RACINE_SRC = join(RACINE_LIB, 'src');

/** Liste récursivement les fichiers `.ts` de production (hors specs/tests/d.ts). */
function fichiersSource(dossier: string): string[] {
  return readdirSync(dossier, { withFileTypes: true }).flatMap((entree) => {
    const chemin = join(dossier, entree.name);
    if (entree.isDirectory()) {
      return fichiersSource(chemin);
    }
    if (!entree.name.endsWith('.ts')) {
      return [];
    }
    if (
      entree.name.endsWith('.spec.ts') ||
      entree.name.endsWith('.test.ts') ||
      entree.name.endsWith('.d.ts')
    ) {
      return [];
    }
    return [chemin];
  });
}

/** Extrait tous les spécifieurs de module importés (statiques et bare imports). */
function specifieursImportes(source: string): string[] {
  const regex = /import\s[^'"]*['"]([^'"]+)['"]|import\s*['"]([^'"]+)['"]/g;
  const specifieurs: string[] = [];
  let m: RegExpExecArray | null;
  while ((m = regex.exec(source)) !== null) {
    const specifieur = m[1] ?? m[2];
    if (specifieur) {
      specifieurs.push(specifieur);
    }
  }
  return specifieurs;
}

describe('garde-fou pureté du shared-kernel (DEC-07)', () => {
  const fichiers = fichiersSource(RACINE_SRC);

  it('détecte bien des fichiers source à analyser', () => {
    expect(fichiers.length).toBeGreaterThan(0);
  });

  it('CA1 — aucun import de framework / d’un autre paquet (imports relatifs uniquement)', () => {
    const violations: string[] = [];
    for (const fichier of fichiers) {
      const contenu = readFileSync(fichier, 'utf8');
      for (const specifieur of specifieursImportes(contenu)) {
        const relatif =
          specifieur.startsWith('./') || specifieur.startsWith('../');
        if (!relatif) {
          violations.push(`${fichier} → import « ${specifieur} »`);
        }
      }
    }
    expect(
      violations,
      `Le shared-kernel doit rester pur (value objects) : imports non relatifs interdits.\n${violations.join('\n')}`,
    ).toEqual([]);
  });

  it('CA2 — fan-out = 0 : aucune dépendance runtime hormis tslib', () => {
    const pkg = JSON.parse(
      readFileSync(join(RACINE_LIB, 'package.json'), 'utf8'),
    ) as { dependencies?: Record<string, string> };
    const deps = Object.keys(pkg.dependencies ?? {}).filter(
      (nom) => nom !== 'tslib',
    );
    expect(
      deps,
      `Le shared-kernel doit rester à fan-out = 0 : dépendance(s) interdite(s) → ${deps.join(', ')}`,
    ).toEqual([]);
  });
});
