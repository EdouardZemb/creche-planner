// @ts-check
/**
 * Jeu d'essai du tri Dependabot. Volontairement HOSTILE : chaque cas décrit une
 * façon dont une PR pourrait être fusionnée à tort. Lancé par le job
 * `dependances-autotest` de ci.yml : `node --test .github/workflows/scripts/dependances/`.
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import {
  CONTROLES_ATTENDUS,
  OUTILLAGE_PORTES,
  decider,
  examinerAvis,
  examinerControles,
  examinerPolitique,
  lireMetadonnees,
  lireVersionsDepart,
  natureMontee,
} from './tri.mjs';

const DEPOT = 'proprio/depot';
const SHA = 'a'.repeat(40);

function message(deps) {
  return [
    'chore(deps): bump x',
    '',
    '---',
    'updated-dependencies:',
    ...deps.flatMap((d) => [
      `- dependency-name: ${d.nom}`,
      `  dependency-version: ${d.cible}`,
      `  dependency-type: ${d.type ?? 'direct:production'}`,
      `  update-type: version-update:semver-${d.maj ?? 'patch'}`,
    ]),
    '...',
    '',
    'Signed-off-by: dependabot[bot] <support@github.com>',
  ].join('\n');
}

function scenario(sur = {}) {
  const deps = sur.deps ?? [{ nom: 'zod', depart: '4.4.3', cible: '4.4.4' }];
  const pr = {
    numero: 1,
    titre: 'chore(deps): bump zod',
    auteur: { login: 'dependabot[bot]', type: 'Bot' },
    brancheTete: 'dependabot/npm_and_yarn/zod-4.4.4',
    depotTete: DEPOT,
    depotBase: DEPOT,
    brouillon: false,
    corps: deps
      .map(
        (d) =>
          `Bumps [${d.nom}](https://github.com/x/y) from ${d.depart} to ${d.cible}.`,
      )
      .join('\n'),
    shaTete: SHA,
    etatFusion: 'clean',
    ouverteLe: '2026-09-28T00:00:00Z',
    ...sur.pr,
  };
  const commits = sur.commits ?? [
    {
      sha: SHA,
      auteur: 'dependabot[bot]',
      verifie: true,
      message: message(deps),
    },
  ];
  const fichiers = sur.fichiers ?? ['package.json', 'pnpm-lock.yaml'];
  const politique = examinerPolitique(pr, commits, fichiers, DEPOT);
  const sain = (nom) => ({ nom, ok: true, avis: [] });
  const avis = examinerAvis(
    sur.avisDepart ?? politique.aVerifier.map((d) => sain(d.nom)),
    sur.avisCible ?? politique.aVerifier.map((d) => sain(d.nom)),
  );
  const controles = examinerControles(
    sur.controles ??
      CONTROLES_ATTENDUS.map((nom) => ({
        nom,
        statut: 'completed',
        conclusion: 'success',
      })),
    sur.statuts ?? [],
    pr.etatFusion,
  );
  return decider(politique, avis, controles);
}

test('témoin : un correctif npm propre, tous gates verts, est PRÊT', () => {
  const v = scenario();
  assert.equal(v.decision, 'prete', v.raisons.join(' ; '));
});

test('témoin : une mineure de production (hors 0.x) est PRÊTE', () => {
  const v = scenario({
    deps: [{ nom: 'zod', depart: '4.4.3', cible: '4.6.5', maj: 'minor' }],
  });
  assert.equal(v.decision, 'prete', v.raisons.join(' ; '));
});

// --- Provenance ---------------------------------------------------------------

test('un auteur humain est à la main', () => {
  assert.equal(
    scenario({ pr: { auteur: { login: 'quelquun', type: 'User' } } }).decision,
    'a-la-main',
  );
});

test('un login « dependabot[bot] » sans type Bot est refusé', () => {
  assert.equal(
    scenario({ pr: { auteur: { login: 'dependabot[bot]', type: 'User' } } })
      .decision,
    'a-la-main',
  );
});

test('une branche venue d’un fork est refusée', () => {
  assert.equal(
    scenario({ pr: { depotTete: 'autre/depot' } }).decision,
    'a-la-main',
  );
});

test('un commit ajouté à la main sur la branche Dependabot bloque', () => {
  const deps = [{ nom: 'zod', depart: '4.4.3', cible: '4.4.4' }];
  const v = scenario({
    commits: [
      {
        sha: 'b'.repeat(40),
        auteur: 'dependabot[bot]',
        verifie: true,
        message: message(deps),
      },
      { sha: SHA, auteur: 'quelquun', verifie: true, message: 'fix' },
    ],
  });
  assert.equal(v.decision, 'a-la-main');
  assert.ok(v.raisons.some((r) => r.includes('2 commits')));
});

test('un commit sans signature vérifiée bloque', () => {
  const deps = [{ nom: 'zod', depart: '4.4.3', cible: '4.4.4' }];
  const v = scenario({
    commits: [
      {
        sha: SHA,
        auteur: 'dependabot[bot]',
        verifie: false,
        message: message(deps),
      },
    ],
  });
  assert.equal(v.decision, 'a-la-main');
});

test('un commit de tête différent de celui évalué bloque', () => {
  const deps = [{ nom: 'zod', depart: '4.4.3', cible: '4.4.4' }];
  const v = scenario({
    commits: [
      {
        sha: 'c'.repeat(40),
        auteur: 'dependabot[bot]',
        verifie: true,
        message: message(deps),
      },
    ],
  });
  assert.equal(v.decision, 'a-la-main');
});

// --- Périmètre ----------------------------------------------------------------

test('une PR qui touche un workflow est à la main, même en patch', () => {
  const v = scenario({
    fichiers: ['package.json', '.github/workflows/dependabot-fusion.yml'],
  });
  assert.equal(v.decision, 'a-la-main');
});

test('une action GitHub est à la main', () => {
  const v = scenario({
    pr: { brancheTete: 'dependabot/github_actions/actions/checkout-7.1.0' },
  });
  assert.equal(v.decision, 'a-la-main');
});

test('une image Docker est à la main', () => {
  const v = scenario({
    pr: { brancheTete: 'dependabot/docker_compose/nats-2.11' },
    fichiers: ['docker-compose.yml'],
  });
  assert.equal(v.decision, 'a-la-main');
});

test('une liste de fichiers vide (illisible) bloque', () => {
  assert.equal(scenario({ fichiers: [] }).decision, 'a-la-main');
});

// --- Nature des montées ---------------------------------------------------------

test('0.x : une « mineure » est traitée comme une majeure', () => {
  assert.equal(natureMontee('0.79.0', '0.80.0'), 'major');
  const v = scenario({
    deps: [
      {
        nom: '@opentelemetry/sdk-node',
        depart: '0.221.0',
        cible: '0.222.0',
        maj: 'minor',
      },
    ],
  });
  assert.equal(v.decision, 'a-la-main');
});

test('0.0.x : un correctif est traité comme une majeure', () => {
  assert.equal(natureMontee('0.0.3', '0.0.4'), 'major');
});

test('une pré-version n’est jamais tranquille', () => {
  assert.equal(natureMontee('4.4.3', '4.5.0-rc.1'), 'major');
});

test('l’étiquette Dependabot ne peut pas minimiser une majeure', () => {
  const v = scenario({
    deps: [{ nom: 'zod', depart: '4.4.3', cible: '5.0.0', maj: 'patch' }],
  });
  assert.equal(v.decision, 'a-la-main');
  assert.ok(v.raisons.some((r) => r.includes('majeure')));
});

test('l’étiquette Dependabot peut durcir une lecture', () => {
  const v = scenario({
    deps: [{ nom: 'zod', depart: '4.4.3', cible: '4.4.4', maj: 'major' }],
  });
  assert.equal(v.decision, 'a-la-main');
});

test('l’outillage d’un gate est à la main, même en patch', () => {
  for (const nom of [
    'eslint',
    '@nx/js',
    '@stryker-mutator/core',
    '@pact-foundation/pact',
    'typescript',
    'prettier',
  ]) {
    const v = scenario({
      deps: [
        { nom, depart: '1.0.0', cible: '1.0.1', type: 'direct:development' },
      ],
    });
    assert.equal(v.decision, 'a-la-main', nom);
  }
});

test('une dépendance indirecte est à la main', () => {
  const v = scenario({
    deps: [
      { nom: 'multer', depart: '2.2.0', cible: '2.3.0', type: 'indirect' },
    ],
  });
  assert.equal(v.decision, 'a-la-main');
});

// --- Métadonnées et corps non fiables -----------------------------------------------

test('des métadonnées absentes bloquent', () => {
  const v = scenario({
    commits: [
      {
        sha: SHA,
        auteur: 'dependabot[bot]',
        verifie: true,
        message: 'chore: bump',
      },
    ],
  });
  assert.equal(v.decision, 'a-la-main');
});

test('une version de départ introuvable bloque', () => {
  const v = scenario({ pr: { corps: 'rien ici' } });
  assert.equal(v.decision, 'a-la-main');
});

test('des notes de version qui mentent sur la version de départ invalident la lecture', () => {
  const corps = [
    'Bumps [zod](https://github.com/x/y) from 4.4.3 to 4.4.4.',
    '<blockquote>',
    'Bumps [zod](https://github.com/x/y) from 4.4.2 to 4.4.4.',
    '</blockquote>',
  ].join('\n');
  assert.equal(lireVersionsDepart(corps).has('zod'), false);
  assert.equal(scenario({ pr: { corps } }).decision, 'a-la-main');
});

test('le tableau d’une PR groupée se lit', () => {
  const corps =
    '| [@opentelemetry/resources](https://x) | `2.10.0` | `2.11.0` |\n| drizzle-orm | `0.45.2` | `0.45.3` |';
  const v = lireVersionsDepart(corps);
  assert.equal(v.get('@opentelemetry/resources'), '2.10.0');
  assert.equal(v.get('drizzle-orm'), '0.45.2');
});

test('le bloc YAML de Dependabot se lit, noms entre guillemets compris', () => {
  const d = lireMetadonnees(
    message([{ nom: '"@nestjs/core"', cible: '11.1.2', maj: 'minor' }]),
  );
  assert.equal(d[0].nom, '@nestjs/core');
  assert.equal(d[0].typeMaj, 'version-update:semver-minor');
});

// --- Sécurité ------------------------------------------------------------------------

test('une version de départ touchée par un avis fait une PR de SÉCURITÉ, jamais prête', () => {
  const v = scenario({
    avisDepart: [
      { nom: 'zod', ok: true, avis: [{ ghsa: 'GHSA-xxxx', severite: 'high' }] },
    ],
  });
  assert.equal(v.decision, 'securite');
});

test('la sécurité reste visible même quand la CI est rouge', () => {
  const v = scenario({
    avisDepart: [
      { nom: 'zod', ok: true, avis: [{ ghsa: 'GHSA-xxxx', severite: 'low' }] },
    ],
    controles: CONTROLES_ATTENDUS.map((nom) => ({
      nom,
      statut: 'completed',
      conclusion: 'failure',
    })),
  });
  assert.equal(v.decision, 'securite');
});

test('des avis illisibles ne valent JAMAIS « aucun avis »', () => {
  const v = scenario({
    avisDepart: [{ nom: 'zod', ok: false, erreur: '503' }],
  });
  assert.equal(v.decision, 'a-la-main');
});

test('une version cible encore vulnérable bloque', () => {
  const v = scenario({
    avisCible: [
      { nom: 'zod', ok: true, avis: [{ ghsa: 'GHSA-yyyy', severite: 'high' }] },
    ],
  });
  assert.equal(v.decision, 'a-la-main');
});

// --- Contrôles -----------------------------------------------------------------------

test('un contrôle attendu pas encore rapporté fait attendre', () => {
  const v = scenario({
    controles: [{ nom: 'ci', statut: 'completed', conclusion: 'success' }],
  });
  assert.equal(v.decision, 'attente');
});

test('un contrôle en cours fait attendre', () => {
  const controles = CONTROLES_ATTENDUS.map((nom) => ({
    nom,
    statut: 'completed',
    conclusion: 'success',
  }));
  controles.push({ nom: 'e2e-web', statut: 'in_progress', conclusion: null });
  assert.equal(scenario({ controles }).decision, 'attente');
});

test('un gate NON requis en échec (security) bloque quand même', () => {
  const controles = CONTROLES_ATTENDUS.map((nom) => ({
    nom,
    statut: 'completed',
    conclusion: nom === 'security' ? 'failure' : 'success',
  }));
  const v = scenario({ controles });
  assert.equal(v.decision, 'a-la-main');
  assert.ok(v.raisons.some((r) => r.includes('security')));
});

test('une conclusion « neutral » ou « cancelled » n’est pas un vert', () => {
  for (const conclusion of [
    'neutral',
    'cancelled',
    'timed_out',
    'action_required',
    'stale',
  ]) {
    const controles = CONTROLES_ATTENDUS.map((nom) => ({
      nom,
      statut: 'completed',
      conclusion: 'success',
    }));
    controles.push({ nom: 'e2e-web', statut: 'completed', conclusion });
    assert.equal(scenario({ controles }).decision, 'a-la-main', conclusion);
  }
});

test('un statut de commit en échec bloque', () => {
  assert.equal(
    scenario({ statuts: [{ contexte: 'externe', etat: 'failure' }] }).decision,
    'a-la-main',
  );
});

test('en retard sur main : on attend le rebase de Dependabot', () => {
  assert.equal(scenario({ pr: { etatFusion: 'behind' } }).decision, 'attente');
});

test('un refus de la protection de branche sans cause visible bloque', () => {
  assert.equal(
    scenario({ pr: { etatFusion: 'blocked' } }).decision,
    'a-la-main',
  );
  assert.equal(
    scenario({ pr: { etatFusion: 'unstable' } }).decision,
    'a-la-main',
  );
});

test('un conflit bloque', () => {
  assert.equal(scenario({ pr: { etatFusion: 'dirty' } }).decision, 'a-la-main');
});

// --- Cohérence avec dependabot.yml ---------------------------------------------------

test('le groupe `outillage-portes` de dependabot.yml recopie OUTILLAGE_PORTES à l’identique', () => {
  const yml = readFileSync(
    new URL('../../../dependabot.yml', import.meta.url),
    'utf8',
  );
  const lignes = yml.split(/\r?\n/);
  const debut = lignes.findIndex((l) => /^\s{6}outillage-portes:\s*$/.test(l));
  assert.notEqual(debut, -1, 'groupe outillage-portes introuvable');
  const motifs = [];
  let dansPatterns = false;
  for (const l of lignes.slice(debut + 1)) {
    if (/^\s{6}\S/.test(l) || /^\s{0,4}\S/.test(l)) break;
    if (/^\s{8}patterns:\s*$/.test(l)) {
      dansPatterns = true;
      continue;
    }
    if (/^\s{8}\S/.test(l)) dansPatterns = false;
    const m = /^\s{10}-\s*'([^']+)'\s*$/.exec(l);
    if (dansPatterns && m) motifs.push(m[1]);
  }
  assert.deepEqual(motifs, OUTILLAGE_PORTES);
});
