// @ts-check
/**
 * Jeu d'essai du gate de mutation sur le code modifié. Chaque cas est une façon
 * de laisser passer à tort (ou de bloquer pour du code ancien). Rejoué par le
 * job `mutation-delta` AVANT de juger la PR : un gate cassé ne juge personne.
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  estMute,
  lireNomsStatuts,
  lirePlages,
  outillageModifie,
  planifier,
} from './plan.mjs';
import { juger } from './verdict.mjs';

const LIB = {
  dossier: 'libs/tarif/domain',
  projet: 'tarif-domain',
  mutate: ['src/lib/**/*.ts', '!src/**/*.spec.ts', '!src/lib/types.ts'],
};

function plan(changements, plages = new Map(), sur = {}) {
  return planifier({
    libs: [LIB],
    baseTrouvee: true,
    changements: lireNomsStatuts(changements.join('\n')),
    plages,
    outillageModifie: false,
    ...sur,
  }).get(LIB.dossier);
}

const P = (...entrees) => new Map(entrees);

// --- Plan : les modes ------------------------------------------------------------

test('code muté non touché : rien', () => {
  assert.equal(plan(['M\tapps/web/src/x.ts']).mode, 'rien');
});

test('lignes modifiées : delta limité aux plages', () => {
  const p = plan(
    ['M\tlibs/tarif/domain/src/lib/calcul.ts'],
    P([
      'libs/tarif/domain/src/lib/calcul.ts',
      [
        [10, 12],
        [40, 40],
      ],
    ]),
  );
  assert.equal(p.mode, 'delta');
  assert.deepEqual(p.mutate, [
    'src/lib/calcul.ts:10-12',
    'src/lib/calcul.ts:40-40',
  ]);
});

test('fichier exclu par la config : jamais muté, même touché', () => {
  const p = plan(
    ['M\tlibs/tarif/domain/src/lib/types.ts'],
    P(['libs/tarif/domain/src/lib/types.ts', [[1, 5]]]),
  );
  assert.equal(p.mode, 'rien');
});

test('suppressions seules : rien à juger, dit comme tel', () => {
  const p = plan(
    ['M\tlibs/tarif/domain/src/lib/calcul.ts'],
    P(['libs/tarif/domain/src/lib/calcul.ts', []]),
  );
  assert.equal(p.mode, 'rien');
  assert.match(p.raison, /suppressions seules/);
});

// --- Plan : les quatre replis --------------------------------------------------------

test('repli 1 — base introuvable : complet, jamais rien', () => {
  const p = plan([], P(), { baseTrouvee: false });
  assert.equal(p.mode, 'complet');
  assert.match(p.raison, /introuvable/);
});

test('repli 2 — config de mutation ou de test de la lib modifiée : complet', () => {
  for (const f of [
    'stryker.config.mjs',
    'vitest.config.mts',
    'tsconfig.lib.json',
    'package.json',
  ]) {
    assert.equal(plan([`M\tlibs/tarif/domain/${f}`]).mode, 'complet', f);
  }
});

test('repli 2 — version de Stryker ou de Vitest changée à la racine : complet', () => {
  assert.equal(plan([], P(), { outillageModifie: true }).mode, 'complet');
  assert.equal(
    outillageModifie(
      '-    "@stryker-mutator/core": "9.6.1",\n+    "@stryker-mutator/core": "9.7.0",',
    ),
    true,
  );
  assert.equal(outillageModifie('+    "vitest": "4.1.0",'), true);
  assert.equal(outillageModifie('+    "zod": "4.6.5",'), false);
  assert.equal(outillageModifie('+++ b/package.json'), false);
});

test('repli 3 — seuls des tests changent : complet (les tests ont pu être affaiblis)', () => {
  const p = plan(['M\tlibs/tarif/domain/src/lib/calcul.spec.ts']);
  assert.equal(p.mode, 'complet');
  assert.match(p.raison, /seuls des fichiers de test/);
});

test('repli 3 — un test SUPPRIMÉ compte aussi', () => {
  assert.equal(
    plan(['D\tlibs/tarif/domain/src/lib/calcul.spec.ts']).mode,
    'complet',
  );
});

test('le gate modifié se juge sur tout', () => {
  assert.equal(
    plan(['M\t.github/workflows/scripts/mutation-delta/verdict.mjs']).mode,
    'complet',
  );
});

test('un changement de ci.yml seul ne déclenche pas de run complet', () => {
  assert.equal(plan(['M	.github/workflows/ci.yml']).mode, 'rien');
  const p = plan(
    ['M	.github/workflows/ci.yml', 'M	libs/tarif/domain/src/lib/calcul.ts'],
    P(['libs/tarif/domain/src/lib/calcul.ts', [[3, 4]]]),
  );
  assert.equal(p.mode, 'delta');
});

test('renommage pur : aucune ligne à juger, le code ancien ne revient pas', () => {
  // git -M : `R100` sans hunk → aucune plage ; le fichier déplacé n'est pas « ajouté ».
  const p = plan(
    ['R100\tlibs/tarif/domain/src/lib/a.ts\tlibs/tarif/domain/src/lib/b.ts'],
    P(['libs/tarif/domain/src/lib/b.ts', []]),
  );
  assert.equal(p.mode, 'rien');
});

test('renommage avec retouche : seules les lignes retouchées', () => {
  const p = plan(
    ['R092\tlibs/tarif/domain/src/lib/a.ts\tlibs/tarif/domain/src/lib/b.ts'],
    P(['libs/tarif/domain/src/lib/b.ts', [[7, 8]]]),
  );
  assert.deepEqual(p.mutate, ['src/lib/b.ts:7-8']);
});

// --- Lecture git ---------------------------------------------------------------------

test('plages : hunks côté nouveau, suppressions pures ignorées', () => {
  const diff = [
    'diff --git a/x.ts b/x.ts',
    '--- a/x.ts',
    '+++ b/x.ts',
    '@@ -3,0 +4,2 @@',
    '@@ -10 +12 @@',
    '@@ -20,3 +23,0 @@',
    'diff --git a/y.ts b/y.ts',
    '--- a/y.ts',
    '+++ /dev/null',
    '@@ -1,4 +0,0 @@',
  ].join('\n');
  assert.deepEqual(
    [...lirePlages(diff)],
    [
      [
        'x.ts',
        [
          [4, 5],
          [12, 12],
        ],
      ],
    ],
  );
});

test('motifs : positifs puis négatifs, dans l’ordre', () => {
  assert.equal(estMute('src/lib/a/b.ts', LIB.mutate), true);
  assert.equal(estMute('src/lib/a.spec.ts', LIB.mutate), false);
  assert.equal(estMute('src/index.ts', LIB.mutate), false);
});

// --- Verdict ------------------------------------------------------------------------

const rapport = (...statuts) =>
  JSON.stringify({
    files: {
      'src/lib/a.ts': {
        mutants: statuts.map((s, i) => ({
          status: s,
          mutatorName: 'M',
          replacement: 'x',
          location: { start: { line: i + 1 } },
        })),
      },
    },
  });

test('NaN : aucun mutant = « rien à juger », jamais un score qui passe en silence', () => {
  const v = juger(rapport(), 80);
  assert.equal(v.etat, 'rien-a-juger');
  assert.equal(v.score, null);
});

test('tous ignorés par dérogation : rien à juger, et c’est dit', () => {
  const v = juger(rapport('Ignored', 'Ignored'), 80);
  assert.equal(v.etat, 'rien-a-juger');
  assert.match(v.detail, /2 ignoré/);
});

test('rapport absent ou illisible : erreur, jamais un vert', () => {
  assert.equal(juger(null, 80).etat, 'erreur');
  assert.equal(juger('{pas du json', 80).etat, 'erreur');
  assert.equal(juger('{}', 80).etat, 'erreur');
});

test('seuil absent de la config : erreur, pas un seuil par défaut', () => {
  assert.equal(juger(rapport('Killed'), Number(undefined)).etat, 'erreur');
});

test('score : Killed et Timeout détectent, Survived et NoCoverage non', () => {
  assert.equal(
    juger(rapport('Killed', 'Timeout', 'Killed', 'Killed', 'Survived'), 80)
      .etat,
    'passe',
  ); // 80 %
  assert.equal(
    juger(rapport('Killed', 'Killed', 'Killed', 'NoCoverage'), 80).etat,
    'echoue',
  ); // 75 %
});

test('CompileError et RuntimeError n’entrent pas au score', () => {
  const v = juger(rapport('Killed', 'CompileError', 'RuntimeError'), 80);
  assert.equal(v.etat, 'passe');
  assert.equal(v.score, 100);
});

test('les survivants sont listés avec leur ligne', () => {
  const v = juger(rapport('Killed', 'Survived'), 80);
  assert.deepEqual(
    v.survivants.map((s) => s.ligne),
    [2],
  );
});
