// @ts-check
/**
 * VEILLE DE RÉGRESSION À COMMIT CONSTANT — « ceci était vert hier et ne l'est
 * plus, sans qu'une ligne change ».
 *
 * ── LE POINT MORT COMBLÉ ────────────────────────────────────────────────────
 * Le 2026-10-03 à 15h00, un audit conclut « `main` est verte ». À 17h28, la
 * MÊME branche, au MÊME commit, échoue la porte `security` : la base de
 * vulnérabilités de Trivy avait avancé entre-temps. Les deux affirmations
 * étaient vraies à leur heure ; la première était fausse quand on l'a relue.
 *
 * Les veilles existantes ne disent pas cela. `veille-alertes.yml` répond « il y
 * a N alertes ouvertes », `image-scan.yml` « voici les CVE des images en
 * ligne ». Aucune ne formule la DIFFÉRENCE, qui est la seule information utile
 * un matin : qu'est-ce qui a changé de verdict SANS que le dépôt change ?
 *
 * ── D'OÙ VIENT LA DIFFÉRENCE : AUCUN ÉTAT STOCKÉ ────────────────────────────
 * Ce script ne garde rien d'un jour sur l'autre, et c'est volontaire : un
 * instantané rangé dans un cache est une affirmation de plus qui peut périmer.
 * GitHub conserve TOUS les check runs d'un même commit, chacun daté. La
 * chronologie est donc déjà là : pour un nom de contrôle donné, sur UN SEUL
 * sha, une conclusion `success` suivie plus tard d'un `failure` est exactement
 * la régression cherchée — et elle ne peut pas venir d'un diff, puisqu'il n'y
 * en a pas.
 *
 * ── CE QUE LA CHRONOLOGIE SEULE NE VOIT PAS, ET LE RATTRAPAGE ───────────────
 * Si rien ne RE-JOUE un contrôle, aucune nouvelle conclusion n'apparaît et la
 * régression reste invisible. Pour la porte dont la vérité dépend du monde
 * extérieur — l'analyse SCA de `pnpm-lock.yaml` par Trivy — le workflow la
 * REJOUE lui-même chaque jour, avec les réglages de `ci.yml`, et compare son
 * verdict d'aujourd'hui à la conclusion du dernier `security` sur le même sha.
 * C'est ce rejeu qui aurait rendu lisible l'épisode de 17h28, le matin même.
 *
 * ── CONTRAT ─────────────────────────────────────────────────────────────────
 * Un run VERT dit DEUX choses : la lecture a eu lieu, ET aucun contrôle n'a
 * changé de verdict en mal à commit constant.
 * Un run ROUGE dit toujours LAQUELLE des deux :
 *   - `RÉGRESSION` — un contrôle vert est devenu rouge sans diff ;
 *   - `POINT MORT` — on n'a pas pu regarder.
 * Règle cardinale, héritée de `veille-alertes.mjs` : **un appel qui échoue
 * n'est JAMAIS lu comme « rien à signaler »**.
 *
 * NON BLOQUANT pour la chaîne : aucun build ne dépend de ce workflow, il n'est
 * pas un contrôle requis. Il rougit pour être VU.
 *
 * Variables :
 *   GITHUB_TOKEN          jeton du run (`checks: read`, `contents: read`)
 *   GITHUB_REPOSITORY     défaut EdouardZemb/creche-planner
 *   REGRESSION_REF        branche surveillée (défaut `main`)
 *   REGRESSION_TRIVY      chemin du JSON produit par le rejeu Trivy du jour
 *   REGRESSION_DRY_RUN    jeu d'essai sans réseau : `1` (régression de
 *                         chronologie), `trivy` (rejeu Trivy divergent),
 *                         `point-mort` (API muette ⇒ doit sortir ROUGE),
 *                         `vert` (rien à signaler ⇒ doit sortir VERT)
 *   GITHUB_STEP_SUMMARY   fichier de résumé (posé par Actions)
 *
 * Zéro dépendance npm (Node pur, `fetch` natif).
 */

import { appendFileSync, readFileSync } from 'node:fs';

const REPO = process.env.GITHUB_REPOSITORY ?? 'EdouardZemb/creche-planner';
const REF = process.env.REGRESSION_REF ?? 'main';
const DRY_RUN = process.env.REGRESSION_DRY_RUN ?? '';
const JETON = process.env.GITHUB_TOKEN ?? '';

/** Conclusions qui comptent comme un échec. `cancelled` et `skipped` n'en sont pas. */
const ECHECS = new Set(['failure', 'timed_out', 'action_required', 'stale']);

/** Les lignes du résumé, écrites dans `GITHUB_STEP_SUMMARY` à la fin. */
const resume = [];
/** @param {string} ligne */
function dire(ligne) {
  resume.push(ligne);
  console.log(ligne);
}

/**
 * Appel GitHub qui ne ment jamais par omission : un échec LÈVE, il ne rend pas
 * une liste vide. C'est la différence entre « rien à signaler » et « je n'ai
 * pas pu regarder », et c'est tout l'objet de ce fichier.
 *
 * @param {string} chemin
 * @returns {Promise<{ corps: any, lien: string | null }>}
 */
async function appeler(chemin) {
  const reponse = await fetch(`https://api.github.com${chemin}`, {
    headers: {
      accept: 'application/vnd.github+json',
      authorization: `Bearer ${JETON}`,
      'x-github-api-version': '2022-11-28',
      'user-agent': 'veille-regression',
    },
  });
  if (!reponse.ok) {
    const detail = await reponse.text().catch(() => '');
    throw new Error(
      `GET ${chemin} → HTTP ${reponse.status}. ${detail.slice(0, 300)}`,
    );
  }
  return { corps: await reponse.json(), lien: reponse.headers.get('link') };
}

/** Tous les check runs d'un sha, reruns compris (`filter=all`), paginés. */
async function checkRuns(sha) {
  const tous = [];
  for (let page = 1; page <= 20; page += 1) {
    const { corps } = await appeler(
      `/repos/${REPO}/commits/${sha}/check-runs?filter=all&per_page=100&page=${page}`,
    );
    const lot = Array.isArray(corps?.check_runs) ? corps.check_runs : [];
    tous.push(...lot);
    if (lot.length < 100) break;
  }
  return tous;
}

/**
 * La chronologie par nom de contrôle, et le verdict qu'on en tire.
 *
 * @param {{ name: string, conclusion: string | null, completed_at: string | null, html_url?: string }[]} runs
 */
function analyser(runs) {
  /** @type {Map<string, { conclusion: string, le: string, url: string }[]>} */
  const parNom = new Map();
  for (const run of runs) {
    if (run.conclusion === null || run.completed_at === null) continue;
    const suite = parNom.get(run.name) ?? [];
    suite.push({
      conclusion: run.conclusion,
      le: run.completed_at,
      url: run.html_url ?? '',
    });
    parNom.set(run.name, suite);
  }

  const regressions = [];
  const retablissements = [];
  for (const [nom, suite] of parNom) {
    suite.sort((a, b) => a.le.localeCompare(b.le));
    const dernier = suite[suite.length - 1];
    if (dernier === undefined || suite.length < 2) continue;
    const anterieurs = suite.slice(0, -1);
    if (
      ECHECS.has(dernier.conclusion) &&
      anterieurs.some((e) => e.conclusion === 'success')
    ) {
      const dernierVert = [...anterieurs]
        .reverse()
        .find((e) => e.conclusion === 'success');
      regressions.push({
        nom,
        vertLe: dernierVert?.le ?? '?',
        rougeLe: dernier.le,
        url: dernier.url,
      });
    }
    if (
      dernier.conclusion === 'success' &&
      anterieurs.some((e) => ECHECS.has(e.conclusion))
    ) {
      retablissements.push({ nom, le: dernier.le });
    }
  }
  return { parNom, regressions, retablissements };
}

/**
 * Le rejeu Trivy du jour, confronté à la dernière conclusion de `security` sur
 * le même sha. C'est le seul endroit où la veille va chercher une vérité qui
 * vit HORS du dépôt — et c'est exactement celle qui a bougé le 2026-10-03.
 *
 * @param {Map<string, { conclusion: string, le: string }[]>} parNom
 * @returns {{ divergence: boolean, message: string } | null}
 */
function confronterTrivy(parNom) {
  const chemin = process.env.REGRESSION_TRIVY;
  let rapport;
  if (DRY_RUN === 'trivy') {
    // Jeu d'essai : la base a avancé depuis le dernier `security` vert.
    rapport = {
      Results: [
        { Vulnerabilities: [{ VulnerabilityID: 'CVE-2026-000001' }] },
      ],
    };
    return evaluerTrivy(rapport, parNom);
  }
  if (chemin === undefined || chemin === '') return null;
  try {
    rapport = JSON.parse(readFileSync(chemin, 'utf8'));
  } catch (erreur) {
    return {
      divergence: true,
      message: `POINT MORT — rejeu Trivy illisible (${chemin}) : ${String(erreur)}`,
    };
  }
  return evaluerTrivy(rapport, parNom);
}

/**
 * Le verdict du rejeu, une fois le rapport en main.
 *
 * @param {any} rapport
 * @param {Map<string, { conclusion: string, le: string }[]>} parNom
 * @returns {{ divergence: boolean, message: string }}
 */
function evaluerTrivy(rapport, parNom) {
  const trouvees = [];
  for (const resultat of rapport?.Results ?? []) {
    for (const vuln of resultat?.Vulnerabilities ?? []) {
      if (typeof vuln?.VulnerabilityID === 'string') {
        trouvees.push(vuln.VulnerabilityID);
      }
    }
  }
  const uniques = [...new Set(trouvees)].sort();

  const suite = parNom.get('security') ?? [];
  const dernier = suite[suite.length - 1];
  if (dernier === undefined) {
    return {
      divergence: uniques.length > 0,
      message:
        uniques.length > 0
          ? `Le rejeu SCA du jour trouve ${uniques.length} CVE bloquante(s) — ${uniques.join(', ')} — et aucun \`security\` n'a jamais conclu sur ce commit.`
          : 'Rejeu SCA du jour : aucune CVE bloquante (aucun `security` antérieur à comparer).',
    };
  }
  if (dernier.conclusion === 'success' && uniques.length > 0) {
    return {
      divergence: true,
      message: `RÉGRESSION HORS DIFF — \`security\` a conclu \`success\` le ${dernier.le} sur ce même commit ; le rejeu d'aujourd'hui trouve ${uniques.length} CVE bloquante(s) : ${uniques.join(', ')}. Rien n'a changé dans le dépôt : c'est la base de vulnérabilités qui a avancé.`,
    };
  }
  return {
    divergence: false,
    message:
      uniques.length === 0
        ? `Rejeu SCA du jour : aucune CVE bloquante, cohérent avec \`security\` (\`${dernier.conclusion}\` le ${dernier.le}).`
        : `Rejeu SCA du jour : ${uniques.length} CVE bloquante(s), déjà reflétées par \`security\` (\`${dernier.conclusion}\` le ${dernier.le}).`,
  };
}

/** Jeux d'essai SYNTHÉTIQUES — aucun appel réseau. Chacun est une sonde négative. */
function jeuDessai(cas) {
  const hier = '2026-10-02T15:00:00Z';
  const tantot = '2026-10-02T17:28:00Z';
  if (cas === 'point-mort') return null; // la lecture lèvera
  if (cas === 'vert') {
    return [
      { name: 'ci', conclusion: 'success', completed_at: hier, html_url: '' },
      {
        name: 'security',
        conclusion: 'success',
        completed_at: tantot,
        html_url: '',
      },
    ];
  }
  // Cas `1` et `trivy` : une chronologie où `security` passe de vert à rouge.
  return [
    { name: 'ci', conclusion: 'success', completed_at: hier, html_url: '' },
    {
      name: 'security',
      conclusion: 'success',
      completed_at: hier,
      html_url: '',
    },
    {
      name: 'security',
      conclusion: cas === 'trivy' ? 'success' : 'failure',
      completed_at: tantot,
      html_url: '',
    },
  ];
}

async function principal() {
  const titre = `# Veille de régression à commit constant — \`${REF}\``;
  dire(titre);

  let sha = '(jeu d’essai)';
  let runs;
  try {
    if (DRY_RUN !== '') {
      runs = jeuDessai(DRY_RUN);
      if (runs === null) throw new Error('jeu d’essai « point-mort » : API muette.');
    } else {
      const { corps } = await appeler(`/repos/${REPO}/commits/${REF}`);
      sha = typeof corps?.sha === 'string' ? corps.sha : '';
      if (sha === '') throw new Error('sha de la branche illisible.');
      runs = await checkRuns(sha);
      if (runs.length === 0) {
        throw new Error(
          `aucun check run lu pour ${sha} — la lecture n'a rien rendu, ce qui ne veut pas dire « tout va bien ».`,
        );
      }
    }
  } catch (erreur) {
    dire('');
    dire('## ❌ POINT MORT');
    dire('');
    dire(`La veille n'a pas pu REGARDER : ${String(erreur)}`);
    dire('');
    dire(
      "Un appel qui échoue n'est jamais lu comme « rien à signaler ». Vérifier les permissions du workflow (`checks: read`, `contents: read`) avant de conclure quoi que ce soit sur l'état de la branche.",
    );
    return 1;
  }

  const { parNom, regressions, retablissements } = analyser(runs);
  const trivy = confronterTrivy(parNom);

  dire('');
  dire(`Commit observé : \`${sha}\` — ${parNom.size} contrôle(s) distinct(s), ${runs.length} exécution(s) au total sur ce même commit.`);

  if (retablissements.length > 0) {
    dire('');
    dire('## ✅ Rétablis sans diff');
    dire('');
    for (const { nom, le } of retablissements) {
      dire(`- \`${nom}\` était rouge, repassé vert le ${le} — même commit.`);
    }
  }

  if (trivy !== null) {
    dire('');
    dire('## Rejeu SCA du jour');
    dire('');
    dire(trivy.message);
  }

  const rouge = regressions.length > 0 || trivy?.divergence === true;

  dire('');
  if (regressions.length > 0) {
    dire('## ❌ RÉGRESSION — vert hier, rouge aujourd’hui, au même commit');
    dire('');
    dire(
      'Aucune ligne du dépôt n’a changé entre ces deux verdicts. La cause est donc **hors du dépôt** : base de vulnérabilités qui avance, dépendance republiée, action tierce mise à jour, service indisponible.',
    );
    dire('');
    for (const { nom, vertLe, rougeLe, url } of regressions) {
      dire(
        `- \`${nom}\` — vert le ${vertLe}, rouge le ${rougeLe}${url === '' ? '' : ` ([run](${url}))`}.`,
      );
    }
  } else if (!rouge) {
    dire('## ✅ Aucun changement de verdict à commit constant');
    dire('');
    dire(
      'La lecture a bien eu lieu, et aucun contrôle vert n’est devenu rouge sans diff.',
    );
  }

  return rouge ? 1 : 0;
}

const code = await principal();
const fichier = process.env.GITHUB_STEP_SUMMARY;
if (fichier !== undefined && fichier !== '') {
  appendFileSync(fichier, `${resume.join('\n')}\n`);
}
process.exitCode = code;
