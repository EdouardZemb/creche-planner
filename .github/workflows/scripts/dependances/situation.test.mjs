// @ts-check
/**
 * Jeu d'essai du récapitulatif et de la fusion, contre un faux client GitHub.
 * Aucun appel réseau. Lancé par `dependances-autotest` (ci.yml).
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { executer } from './fusion.mjs';
import { assainir, code } from './markdown.mjs';
import {
  AUTEUR_ISSUE,
  ETIQUETTE,
  encoderEtat,
  lireEtat,
  priorites,
  publier,
  rendreCorps,
} from './situation.mjs';
import { CONTROLES_ATTENDUS } from './tri.mjs';

const DEPOT = 'proprio/depot';
/** Sortie ignorée : les tests lisent les écritures, pas le texte. */
const muet = () => undefined;
const SHA = 'a'.repeat(40);

/** Faux client : routes par préfixe de chemin, journal des écritures. */
function fauxClient(routes) {
  const ecritures = [];
  const trouver = (chemin) => {
    const cle = Object.keys(routes).find((k) => chemin.startsWith(k));
    return cle === undefined
      ? { ok: false, statut: 404, detail: `route absente : ${chemin}` }
      : routes[cle];
  };
  return {
    ecritures,
    async lire(chemin) {
      const r = trouver(chemin);
      return typeof r === 'function' ? r(chemin) : r;
    },
    async lister(chemin) {
      const r = trouver(chemin);
      return typeof r === 'function' ? r(chemin) : r;
    },
    async ecrire(methode, chemin, corps) {
      ecritures.push({ methode, chemin, corps });
      const r = routes[`${methode} ${chemin}`];
      return r ?? { ok: true, donnees: { number: 42 } };
    },
  };
}

const ok = (donnees) => ({ ok: true, donnees });

function prDependabot(numero, sur = {}) {
  return {
    number: numero,
    title: `chore(deps): bump zod ${numero}`,
    html_url: `https://github.com/${DEPOT}/pull/${numero}`,
    user: { login: 'dependabot[bot]', type: 'Bot' },
    head: {
      sha: SHA,
      ref: 'dependabot/npm_and_yarn/zod-4.4.4',
      repo: { full_name: DEPOT },
    },
    base: { repo: { full_name: DEPOT } },
    draft: false,
    state: 'open',
    body: 'Bumps [zod](https://github.com/colinhacks/zod) from 4.4.3 to 4.4.4.',
    mergeable_state: 'clean',
    created_at: '2026-09-28T00:00:00Z',
    ...sur,
  };
}

const COMMIT = {
  sha: SHA,
  author: { login: 'dependabot[bot]' },
  commit: {
    verification: { verified: true },
    message: [
      'chore(deps): bump zod',
      '---',
      'updated-dependencies:',
      '- dependency-name: zod',
      '  dependency-version: 4.4.4',
      '  dependency-type: direct:production',
      '  update-type: version-update:semver-patch',
      '...',
    ].join('\n'),
  },
};

function routesFusion(pr, sur = {}) {
  return {
    [`repos/${DEPOT}/pulls?`]: ok([pr]),
    [`repos/${DEPOT}/pulls/${pr.number}/commits`]: ok([COMMIT]),
    [`repos/${DEPOT}/pulls/${pr.number}/files`]: ok([
      { filename: 'package.json' },
      { filename: 'pnpm-lock.yaml' },
    ]),
    [`repos/${DEPOT}/pulls/${pr.number}`]: ok(pr),
    'advisories?': ok([]),
    [`repos/${DEPOT}/commits/${SHA}/check-runs`]: ok(
      CONTROLES_ATTENDUS.map((name) => ({
        name,
        status: 'completed',
        conclusion: 'success',
      })),
    ),
    [`repos/${DEPOT}/commits/${SHA}/status`]: ok({ statuses: [] }),
    ...sur,
  };
}

// --- Fusion ----------------------------------------------------------------------

test('fusion : en observation, rien n’est fusionné', async () => {
  const api = fauxClient(routesFusion(prDependabot(7)));
  const code = await executer({
    api,
    depot: DEPOT,
    actif: false,
    ecrireResume: muet,
    journal: muet,
  });
  assert.equal(code, 0);
  assert.equal(api.ecritures.length, 0);
});

test('fusion : active, une PR prête est fusionnée AVEC le SHA évalué', async () => {
  const api = fauxClient(routesFusion(prDependabot(7)));
  await executer({
    api,
    depot: DEPOT,
    actif: true,
    ecrireResume: muet,
    journal: muet,
  });
  assert.equal(api.ecritures.length, 1);
  assert.equal(api.ecritures[0].methode, 'PUT');
  assert.equal(api.ecritures[0].chemin, `repos/${DEPOT}/pulls/7/merge`);
  assert.equal(api.ecritures[0].corps.sha, SHA);
});

test('fusion : un commit de tête qui bouge entre évaluation et fusion fait s’abstenir', async () => {
  let lectures = 0;
  const pr = prDependabot(7);
  const api = fauxClient(
    routesFusion(pr, {
      [`repos/${DEPOT}/pulls/7`]: () => {
        lectures += 1;
        return ok(
          lectures === 1
            ? pr
            : { ...pr, head: { ...pr.head, sha: 'f'.repeat(40) } },
        );
      },
    }),
  );
  await executer({
    api,
    depot: DEPOT,
    actif: true,
    ecrireResume: muet,
    journal: muet,
  });
  assert.equal(api.ecritures.length, 0);
});

test('fusion : un refus de GitHub rougit le run et n’est pas forcé', async () => {
  const api = fauxClient({
    ...routesFusion(prDependabot(7)),
    [`PUT repos/${DEPOT}/pulls/7/merge`]: {
      ok: false,
      statut: 405,
      detail: 'Base branch was modified',
    },
  });
  const code = await executer({
    api,
    depot: DEPOT,
    actif: true,
    ecrireResume: muet,
    journal: muet,
  });
  assert.equal(code, 1);
  assert.equal(api.ecritures.length, 1);
});

test('fusion : une PR humaine n’est même pas évaluée', async () => {
  const humaine = prDependabot(8, {
    user: { login: 'quelquun', type: 'User' },
  });
  const api = fauxClient(routesFusion(humaine));
  await executer({
    api,
    depot: DEPOT,
    actif: true,
    ecrireResume: muet,
    journal: muet,
  });
  assert.equal(api.ecritures.length, 0);
});

test('fusion : une PR de sécurité n’est JAMAIS fusionnée', async () => {
  const api = fauxClient({
    ...routesFusion(prDependabot(7)),
    'advisories?': (chemin) =>
      chemin.includes(encodeURIComponent('zod@4.4.3'))
        ? ok([{ ghsa_id: 'GHSA-1', severity: 'high' }])
        : ok([]),
  });
  await executer({
    api,
    depot: DEPOT,
    actif: true,
    ecrireResume: muet,
    journal: muet,
  });
  assert.equal(api.ecritures.length, 0);
});

test('fusion : base des avis injoignable = aucune fusion (jamais « aucun avis »)', async () => {
  const api = fauxClient({
    ...routesFusion(prDependabot(7)),
    'advisories?': { ok: false, statut: 503, detail: 'indisponible' },
  });
  await executer({
    api,
    depot: DEPOT,
    actif: true,
    ecrireResume: muet,
    journal: muet,
  });
  assert.equal(api.ecritures.length, 0);
});

test('fusion : contrôles illisibles = aucune fusion', async () => {
  const api = fauxClient({
    ...routesFusion(prDependabot(7)),
    [`repos/${DEPOT}/commits/${SHA}/check-runs`]: {
      ok: false,
      statut: 500,
      detail: 'x',
    },
  });
  await executer({
    api,
    depot: DEPOT,
    actif: true,
    ecrireResume: muet,
    journal: muet,
  });
  assert.equal(api.ecritures.length, 0);
});

test('fusion : liste des PR illisible = point mort, run rouge', async () => {
  const api = fauxClient({
    [`repos/${DEPOT}/pulls?`]: { ok: false, statut: 502, detail: 'x' },
  });
  const code = await executer({
    api,
    depot: DEPOT,
    actif: true,
    ecrireResume: muet,
    journal: muet,
  });
  assert.equal(code, 1);
});

// --- Récapitulatif ---------------------------------------------------------------

function donnees(sur = {}) {
  return {
    genereLe: '2026-09-29T06:10:00Z',
    urlRun: `https://github.com/${DEPOT}/actions/runs/1`,
    workflows: ok([
      {
        nom: 'CI',
        conclusion: 'success',
        url: '',
        date: '2026-09-29T00:00:00Z',
        depuis: null,
      },
    ]),
    mainSansCi: null,
    dependabot: ok([]),
    codeScanning: ok([]),
    secrets: ok([]),
    prs: ok([]),
    fusionActive: false,
    ...sur,
  };
}

test('récap : rien à signaler = vert', () => {
  const d = donnees();
  assert.match(rendreCorps(d, priorites(d)), /🟢/);
});

test('récap : une source illisible est un POINT MORT, jamais « aucune alerte »', () => {
  const d = donnees({
    dependabot: { ok: false, statut: 403, detail: 'Resource not accessible' },
  });
  const corps = rendreCorps(d, priorites(d));
  assert.match(corps, /🟠/);
  assert.match(corps, /Point mort/);
  assert.doesNotMatch(corps, /\*\*Dependabot\*\* : aucune/);
});

test('récap : noms de paquets et résumés hostiles ne mentionnent ni ne lient personne', () => {
  const d = donnees({
    dependabot: ok([
      {
        cle: 'dependabot:1',
        gravite: 'high',
        paquet: '@victime/paquet`](https://evil.example)',
        resume:
          'voir @victime et https://evil.example [clic](https://evil.example) <img src=x> autre/depot#1',
        portee: 'runtime',
        url: 'https://evil.example/alerte',
        date: '2026-09-01T00:00:00Z',
      },
    ]),
  });
  const corps = rendreCorps(d, priorites(d));
  // Aucune mention nue : tout « @ » hors code span est suivi du joint invisible.
  const horsCode = corps.replace(/`[^`]*`/g, '');
  assert.doesNotMatch(horsCode, /@(?!⁠)[A-Za-z]/);
  assert.doesNotMatch(horsCode, /\]\(https:\/\/evil/);
  assert.doesNotMatch(corps, /(?<!\\)<img/);
  assert.doesNotMatch(horsCode, /https:\/\/evil/);
  assert.doesNotMatch(horsCode, /#\d/);
});

test('assainir/code : pas de séquence d’échappement coupée, pas de span refermable', () => {
  assert.ok(!assainir('a'.repeat(199) + '[', 200).endsWith('\\'));
  assert.equal(code('ab`c'), '`abc`');
});

test('récap : un workflow rouge sur main est une priorité', () => {
  const d = donnees({
    workflows: ok([
      {
        nom: 'CI',
        conclusion: 'failure',
        url: '',
        date: '2026-09-29T00:00:00Z',
        depuis: '2026-09-27T00:00:00Z',
      },
    ]),
  });
  const p = priorites(d);
  assert.equal(p.length, 1);
  assert.equal(p[0].cle, 'workflow:CI');
  assert.match(rendreCorps(d, p), /Rouge depuis/);
});

test('récap : l’état mémorisé fait l’aller-retour', () => {
  const p = [
    { cle: 'workflow:CI', texte: '' },
    { cle: 'dependabot:3', texte: '' },
  ];
  assert.deepEqual(
    [...(lireEtat(`corps\n${encoderEtat(p)}\n`) ?? [])],
    ['workflow:CI', 'dependabot:3'],
  );
  assert.equal(lireEtat('corps sans marqueur'), null);
  assert.equal(lireEtat('<!-- situation-etat:!!! -->'), null);
});

function issue(numero, sur = {}) {
  return {
    number: numero,
    state: 'open',
    user: { login: AUTEUR_ISSUE },
    body: '',
    ...sur,
  };
}

test('publication : crée l’issue unique si elle n’existe pas', async () => {
  const api = fauxClient({
    [`repos/${DEPOT}/issues?labels=${ETIQUETTE}`]: ok([]),
  });
  const code = await publier({
    api,
    depot: DEPOT,
    proprietaire: 'proprio',
    donnees: donnees(),
    journal: muet,
  });
  assert.equal(code, 0);
  assert.ok(
    api.ecritures.some(
      (e) => e.methode === 'POST' && e.chemin === `repos/${DEPOT}/issues`,
    ),
  );
});

test('publication : met à jour SANS commenter quand rien de nouveau', async () => {
  const d = donnees({
    workflows: ok([
      { nom: 'CI', conclusion: 'failure', url: '', date: '', depuis: null },
    ]),
  });
  const precedent = encoderEtat(priorites(d));
  const api = fauxClient({
    [`repos/${DEPOT}/issues?labels=${ETIQUETTE}`]: ok([
      issue(5, { body: precedent }),
    ]),
  });
  await publier({
    api,
    depot: DEPOT,
    proprietaire: 'proprio',
    donnees: d,
    journal: muet,
  });
  assert.deepEqual(
    api.ecritures.map((e) => e.methode),
    ['PATCH'],
  );
});

test('publication : commente avec mention UNIQUEMENT pour les éléments nouveaux', async () => {
  const d = donnees({
    workflows: ok([
      { nom: 'CI', conclusion: 'failure', url: '', date: '', depuis: null },
    ]),
  });
  const api = fauxClient({
    [`repos/${DEPOT}/issues?labels=${ETIQUETTE}`]: ok([
      issue(5, { body: encoderEtat([]) }),
    ]),
  });
  await publier({
    api,
    depot: DEPOT,
    proprietaire: 'proprio',
    donnees: d,
    journal: muet,
  });
  const commentaire = api.ecritures.find((e) => e.chemin.endsWith('/comments'));
  assert.ok(commentaire);
  assert.match(commentaire.corps.body, /^@proprio /);
});

test('publication : une issue étiquetée par un humain n’est ni reprise ni écrasée', async () => {
  const api = fauxClient({
    [`repos/${DEPOT}/issues?labels=${ETIQUETTE}`]: ok([
      issue(3, { user: { login: 'quelquun' } }),
    ]),
  });
  await publier({
    api,
    depot: DEPOT,
    proprietaire: 'proprio',
    donnees: donnees(),
    journal: muet,
  });
  assert.ok(!api.ecritures.some((e) => e.chemin.includes('/issues/3')));
  assert.ok(
    api.ecritures.some(
      (e) => e.methode === 'POST' && e.chemin === `repos/${DEPOT}/issues`,
    ),
  );
});

test('récap : une high de développement ne notifie pas, une high livrée et une critical si', () => {
  const alerte = (cle, gravite, portee) => ({
    cle,
    gravite,
    paquet: 'p',
    resume: '',
    portee,
    url: '',
    date: '',
  });
  const d = donnees({
    dependabot: ok([
      alerte('dependabot:1', 'high', 'development'),
      alerte('dependabot:2', 'high', 'runtime'),
      alerte('dependabot:3', 'critical', 'development'),
      alerte('dependabot:4', 'high', ''),
    ]),
  });
  const cles = priorites(d).map((x) => x.cle);
  assert.deepEqual(cles.sort(), [
    'dependabot:2',
    'dependabot:3',
    'dependabot:4',
  ]);
  assert.match(
    rendreCorps(d, priorites(d)),
    /1 alerte\(s\) high sur l’outillage de développement/,
  );
});
