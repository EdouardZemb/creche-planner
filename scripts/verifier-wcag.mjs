#!/usr/bin/env node
// @ts-check
/**
 * Porte de la **cible WCAG 2.2 AA** (`AM-49`, lot 9 des standards).
 *
 * ## Pourquoi ce script existe
 *
 * Une cible d'accessibilité se périme de deux façons, et **aucune ne fait rougir
 * quoi que ce soit** :
 *
 *  1. **la cible avance, l'outil reste.** Le dépôt visait WCAG 2.1 AA et son
 *     audit `axe-core` demandait les tags `wcag2a`/`wcag2aa`/`wcag21a`/
 *     `wcag21aa`. Passer la cible à 2.2 sans toucher aux tags laisse l'audit
 *     répondre exactement la même chose qu'avant — vert, et muet sur les neuf
 *     critères ajoutés. Mesuré au lot 9 : ces quatre tags sélectionnent
 *     **69 règles**, et `target-size` (SC 2.5.8) n'en fait pas partie. Cette
 *     règle est en outre déclarée `enabled: false` dans axe-core : **seul** le
 *     tag `wcag22aa` la met en route.
 *  2. **un critère cesse d'être statué.** Un critère « écarté par écrit » dont
 *     le motif disparaît, ou une garde citée dont le test a été renommé, laisse
 *     une ligne de tableau qui a l'air d'un verdict sans plus rien derrière.
 *
 * ## Ce que la porte garantit
 *
 * 1. La **cible annoncée** en tête de la doc 11 est WCAG **2.2 AA**.
 * 2. Le §8 de la doc 11 statue **exactement** les neuf critères ajoutés par
 *    WCAG 2.2 — aucun oublié, aucun inventé. Les identifiants sont **relevés
 *    dans le document** et confrontés au référentiel, jamais recopiés d'un
 *    tableau vers l'autre.
 * 3. Tout critère de niveau **A ou AA** est soit conforme/corrigé, soit
 *    explicitement **écarté par écrit** — un verdict vide est refusé.
 * 4. Toute **garde citée** (« Garde(s) : `…` et `…` », toutes relevées, pas
 *    seulement la première) existe réellement : son libellé se retrouve dans un
 *    fichier de test de `apps/web`. Une garde renommée casse la porte au lieu
 *    de laisser une promesse morte.
 * 5. L'audit `axe-core` demande bien le tag **`wcag22aa`** — c'est le lien entre
 *    la cible déclarée et ce que l'outil regarde, et c'est très exactement ce
 *    qui manquait.
 * 6. L'audit couvre la **présentation mobile** : une largeur sous 768 px y est
 *    exercée. Sur desktop, `display: contents` dissout la barre d'onglets fixe
 *    et la feuille « Plus » en simples liens d'en-tête — un audit desktop seul
 *    ne les voit jamais telles qu'elles sont rendues.
 * 7. Le renoncement écrit sur le **SC 3.3.8** reste vrai : `apps/web/src` ne
 *    contient aucune étape d'authentification propre (mot de passe, captcha).
 *    Le jour où l'application en fait naître une, le renoncement devient faux.
 *
 * ## Ce que la porte NE garantit **pas**
 *
 *  - Elle ne **mesure aucun critère**. C'est le rôle de `apps/web/e2e/a11y.e2e.spec.ts`
 *    (job `e2e-web`) ; ici on garde l'accord entre la cible écrite, les gardes
 *    citées et le périmètre de l'outil.
 *  - Elle ne juge pas la **qualité d'un verdict** : « conforme » peut être écrit
 *    à tort, la porte vérifie qu'il est écrit et étayé par une garde nommée.
 *  - Elle ne voit pas les critères **2.0/2.1**, ni les exigences `UT-xx`.
 *  - Elle ne détecte pas l'apparition d'un **geste de glissement** (SC 2.5.7),
 *    tenu par absence de fonctionnalité : c'est le trou déclaré en doc 11 §8.4.
 *  - Elle ne dit rien de la **passe audio** NVDA/VoiceOver, qui reste humaine.
 *  - Elle ne juge pas la page de connexion **Cloudflare Access** : hors dépôt.
 *
 * ## Usage
 *   pnpm wcag              # vérifie (exit 1 si un constat)
 *   pnpm wcag --autotest   # rejoue les sondes négatives
 *
 * ## Contraintes de conception
 *  - Aucune dépendance : tourne sur un clone sans `node_modules`.
 *  - Aucune conclusion « par défaut » : un balayage qui ne trouve rien ÉCHOUE.
 *  - Lectures `fs` en `try/catch` seul, jamais un test d'existence suivi d'une
 *    lecture (règle CodeQL `js/file-system-race`, bloquante en CI).
 */

import fs from 'node:fs';
import path from 'node:path';

const RACINE = path.resolve(import.meta.dirname, '..');

const DOC = 'docs/11-spec-accessibilite-ct-ut.md';
const AUDIT = 'apps/web/e2e/a11y.e2e.spec.ts';

const FICHIERS = [DOC, AUDIT];

/**
 * Les neuf critères **ajoutés** par WCAG 2.2 à WCAG 2.1, avec leur niveau.
 *
 * C'est une constante du **référentiel externe** (W3C, recommandation du
 * 2023-10-05), pas un miroir d'un autre fichier du dépôt : il n'existe aucune
 * source interne dont on pourrait la dériver. Elle est datée et figée — si le
 * W3C publiait WCAG 2.3, ce serait un nouveau lot, pas une dérive silencieuse.
 */
const CRITERES_22 = [
  { id: '2.4.11', niveau: 'AA' },
  { id: '2.4.12', niveau: 'AAA' },
  { id: '2.4.13', niveau: 'AAA' },
  { id: '2.5.7', niveau: 'AA' },
  { id: '2.5.8', niveau: 'AA' },
  { id: '3.2.6', niveau: 'A' },
  { id: '3.3.7', niveau: 'A' },
  { id: '3.3.8', niveau: 'AA' },
  { id: '3.3.9', niveau: 'AAA' },
];

/** Marques de verdict acceptées pour un critère de la cible (A/AA). */
const VERDICTS = ['✅ conforme', '✅ **corrigé**', '**écarté par écrit**'];

/** @param {string} relatif */
function lire(relatif) {
  try {
    return fs.readFileSync(path.join(RACINE, relatif), 'utf8');
  } catch (erreur) {
    throw new Error(
      `${relatif} illisible : ${/** @type {Error} */ (erreur).message}`,
    );
  }
}

/**
 * Relève les lignes de tableau du §8 de la doc 11 qui statuent un critère.
 *
 * Attendu **dérivé du document** : on lit les identifiants qu'il porte, on ne
 * les y cherche pas un par un depuis `CRITERES_22`. C'est la différence entre
 * « le document contient-il ce que j'attends » (aveugle aux ajouts) et « que
 * statue le document » (qui voit aussi un critère inventé).
 *
 * @param {string} doc
 * @returns {{ id: string, verdict: string, corps: string }[]}
 */
function critereStatues(doc) {
  // Bornée au § 8 SEUL. Lire jusqu'à la fin du fichier ferait juger n'importe
  // quel tableau ajouté plus bas : un « ## 9 » citant un critère de 2.1 en gras
  // (`**1.4.3**`) suffirait à faire rougir la porte sur une addition sans
  // rapport — vérifié, la porte sortait alors 1.
  const debut = doc.indexOf('## 8. Cible WCAG 2.2 AA');
  if (debut === -1) return [];
  const suite = doc.slice(debut + 1);
  const fin = suite.search(/\r?\n## /);
  const section = fin === -1 ? suite : suite.slice(0, fin);
  /** @type {{ id: string, verdict: string, corps: string }[]} */
  const lignes = [];
  for (const ligne of section.split(/\r?\n/)) {
    if (!ligne.startsWith('|')) continue;
    const cellules = ligne
      .split('|')
      .slice(1, -1)
      .map((c) => c.trim());
    if (cellules.length < 3) continue;
    const id = /\*\*(\d+\.\d+\.\d+)\*\*/.exec(cellules[0])?.[1];
    if (id === undefined) continue;
    // §8.1 porte 4 colonnes (critère, niveau, verdict, constat) ; §8.2 en porte
    // 3 (critère, niveau, motif) — le motif y TIENT LIEU de verdict.
    const quatreColonnes = cellules.length >= 4;
    lignes.push({
      id,
      verdict: quatreColonnes ? cellules[2] : 'AAA hors cible',
      corps: quatreColonnes ? cellules[3] : cellules[2],
    });
  }
  return lignes;
}

/**
 * @param {Record<string, string>} contenus
 * @returns {string[]}
 */
function verifier(contenus) {
  /** @type {string[]} */
  const constats = [];
  const doc = contenus[DOC];
  const audit = contenus[AUDIT];

  // 1. La cible annoncée.
  if (!/la cible passe à WCAG 2\.2 AA/.test(doc)) {
    constats.push(
      `${DOC} : la cible WCAG 2.2 AA n'est plus annoncée en tête de document.`,
    );
  }

  // 2. Les neuf critères, ni plus ni moins — comparaison dans les DEUX sens.
  const statues = critereStatues(doc);
  if (statues.length === 0) {
    constats.push(
      `${DOC} : le § 8 ne statue AUCUN critère (tableau absent, renommé ou illisible).`,
    );
  }
  const vus = new Set(statues.map((s) => s.id));
  for (const critere of CRITERES_22) {
    if (!vus.has(critere.id)) {
      constats.push(
        `${DOC} § 8 : le critère WCAG 2.2 ${critere.id} (niveau ${critere.niveau}) n'est statué nulle part.`,
      );
    }
  }
  const connus = new Set(CRITERES_22.map((c) => c.id));
  for (const statue of statues) {
    if (!connus.has(statue.id)) {
      constats.push(
        `${DOC} § 8 : le critère ${statue.id} est statué mais n'appartient pas aux neuf nouveautés de WCAG 2.2.`,
      );
    }
  }

  // 3. Un critère de la cible (A/AA) porte un verdict tranché.
  for (const critere of CRITERES_22) {
    if (critere.niveau === 'AAA') continue;
    const statue = statues.find((s) => s.id === critere.id);
    if (statue === undefined) continue; // déjà signalé en 2.
    if (!VERDICTS.some((v) => statue.verdict.includes(v))) {
      constats.push(
        `${DOC} § 8 : le critère ${critere.id} (${critere.niveau}, dans la cible) ne porte pas de verdict tranché ` +
          `— attendu l'un de ${VERDICTS.map((v) => `« ${v} »`).join(', ')}, lu « ${statue.verdict} ».`,
      );
    }
    if (statue.corps.length < 80) {
      constats.push(
        `${DOC} § 8 : le critère ${critere.id} porte un verdict sans constat étayé (${statue.corps.length} caractères).`,
      );
    }
  }

  // 4. Toute garde citée existe réellement dans un test de `apps/web`.
  const gardes = gardesCitees(doc);
  if (gardes.length === 0) {
    constats.push(
      `${DOC} § 8 : aucune garde n'est citée — un verdict outillé doit nommer le test qui le tient.`,
    );
  }
  for (const garde of gardes) {
    if (!testsWeb().some((t) => t.includes(garde))) {
      constats.push(
        `${DOC} § 8 : la garde « ${garde} » n'existe dans aucun test de apps/web — test renommé, ou promesse morte.`,
      );
    }
  }

  // 5. L'audit demande le tag qui met les règles 2.2 en route.
  const tags = /const TAGS_WCAG_AA = \[([^\]]*)\]/.exec(audit)?.[1] ?? '';
  if (!tags.includes('wcag22aa')) {
    constats.push(
      `${AUDIT} : les tags de l'audit axe ne contiennent pas « wcag22aa ». La cible dit 2.2, ` +
        `l'outil ne regarde que 2.1 — et il reste VERT (target-size est déclarée enabled: false dans axe-core).`,
    );
  }

  // 6. L'audit exerce la présentation mobile.
  if (!/test\.use\(PIXEL_5\)/.test(audit)) {
    constats.push(
      `${AUDIT} : aucun bloc n'audite une largeur sous 768 px. Sur desktop, « display: contents » ` +
        `dissout la barre d'onglets fixe et la feuille « Plus » : l'audit ne les voit jamais telles qu'elles sont rendues.`,
    );
  }

  // 7. Le renoncement du SC 3.3.8 reste vrai.
  for (const trouvaille of authentificationDansWeb()) {
    constats.push(
      `SC 3.3.8 : ${trouvaille} — l'application fait naître sa propre étape d'authentification, ` +
        `donc le renoncement écrit en ${DOC} § 8.1 (« aucune étape d'authentification, tout est délégué ` +
        `à Cloudflare Access ») est devenu FAUX et le critère doit être évalué pour de bon.`,
    );
  }

  return constats;
}

/** Fichiers de test de `apps/web` (unitaires et e2e), lus une seule fois. */
let cacheTests = /** @type {string[] | null} */ (null);
function testsWeb() {
  if (cacheTests !== null) return cacheTests;
  cacheTests = fichiersSous('apps/web/src', /\.(test|spec)\.tsx?$/).concat(
    fichiersSous('apps/web/e2e', /\.spec\.ts$/),
  );
  return cacheTests;
}

/**
 * @param {string} relatif
 * @param {RegExp} motif
 * @returns {string[]}
 */
function fichiersSous(relatif, motif) {
  /** @type {string[]} */
  const contenus = [];
  /** @type {import('node:fs').Dirent[]} */
  let entrees;
  try {
    entrees = fs.readdirSync(path.join(RACINE, relatif), {
      withFileTypes: true,
      recursive: true,
    });
  } catch {
    return contenus;
  }
  for (const entree of entrees) {
    if (!entree.isFile() || !motif.test(entree.name)) continue;
    try {
      contenus.push(
        fs.readFileSync(path.join(entree.parentPath, entree.name), 'utf8'),
      );
    } catch {
      /* fichier disparu entre le balayage et la lecture : sans objet ici */
    }
  }
  return contenus;
}

/**
 * Noms de gardes cités par le § 8, au singulier comme au pluriel.
 *
 * ⚠️ Une première version ne reconnaissait que « Garde : `…` » et n'en captait
 * qu'une : écrire « Gardes : `A` et `B` » faisait tomber le compte de 3 à 2
 * **sans aucun constat** — la porte censée empêcher les promesses mortes en
 * perdait une en silence. On relève donc TOUS les noms entre accents graves de
 * l'énoncé, jusqu'à la fin de la cellule.
 *
 * @param {string} doc
 * @returns {string[]}
 */
function gardesCitees(doc) {
  /** @type {string[]} */
  const noms = [];
  for (const enonce of doc.matchAll(
    /Gardes?\s*:\s*((?:`[^`]+`(?:\s*(?:et|,)\s*)?)+)/g,
  )) {
    for (const nom of enonce[1].matchAll(/`([^`]+)`/g)) noms.push(nom[1]);
  }
  return noms;
}

/**
 * Retire commentaires de ligne, commentaires de bloc et commentaires JSX.
 *
 * Approximation assumée (ce n'est pas un analyseur syntaxique) : une séquence
 * `//` dans un littéral de chaîne — typiquement une URL — voit la fin de sa
 * ligne effacée. C'est sans conséquence ici, les deux motifs recherchés étant
 * des attributs JSX et un mot, jamais une URL. Le sens de l'erreur est le bon :
 * on efface trop, donc on peut manquer un défaut ; on n'en invente jamais.
 *
 * @param {string} source
 * @returns {string}
 */
function sansCommentaires(source) {
  return source
    .replace(/\{\s*\/\*[\s\S]*?\*\/\s*\}/g, ' ')
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/(^|[^:])\/\/.*$/gm, '$1');
}

/**
 * Étapes d'authentification portées par l'application elle-même.
 *
 * On cherche dans le **code de production** seulement : un mock de test qui
 * nomme un mot de passe n'est pas une étape d'authentification de l'app.
 *
 * @returns {string[]}
 */
function authentificationDansWeb() {
  /** @type {string[]} */
  const trouvailles = [];
  /** @type {import('node:fs').Dirent[]} */
  let entrees;
  try {
    entrees = fs.readdirSync(path.join(RACINE, 'apps/web/src'), {
      withFileTypes: true,
      recursive: true,
    });
  } catch {
    return ['apps/web/src est illisible — impossible de tenir le renoncement'];
  }
  let balayes = 0;
  for (const entree of entrees) {
    if (!entree.isFile() || !/\.tsx?$/.test(entree.name)) continue;
    if (/\.(test|spec)\.tsx?$/.test(entree.name)) continue;
    balayes += 1;
    let source = '';
    try {
      source = fs.readFileSync(
        path.join(entree.parentPath, entree.name),
        'utf8',
      );
    } catch {
      continue;
    }
    const relatif = path
      .relative(RACINE, path.join(entree.parentPath, entree.name))
      .replace(/\\/g, '/');
    // Les COMMENTAIRES sont retirés avant l'examen : sans cela, un commentaire
    // disant « aucun captcha ici » — ou ce fichier-ci cité en exemple — rendrait
    // la porte rouge en affirmant l'exact contraire de la vérité. Une porte qui
    // se trompe dans ce sens-là est pire qu'absente : elle accuse du code sain.
    const code = sansCommentaires(source);
    if (/type=(["'])password\1/.test(code)) {
      trouvailles.push(`${relatif} rend un champ de mot de passe`);
    }
    if (/\bcaptcha\b/i.test(code)) {
      trouvailles.push(`${relatif} met en œuvre un captcha`);
    }
  }
  if (balayes === 0) {
    trouvailles.push(
      'aucun fichier source balayé dans apps/web/src — le balayage est cassé, pas le code',
    );
  }
  return trouvailles;
}

/**
 * @param {Record<string, string>} contenus
 * @returns {0 | 1}
 */
function autotest(contenus) {
  /**
   * @param {string} fichier
   * @param {(t: string) => string} transformation
   * @param {string} etiquette
   */
  function muter(fichier, transformation, etiquette) {
    const source = contenus[fichier];
    const mute = transformation(source);
    if (mute === source) {
      throw new Error(
        `sonde « ${etiquette} » : la mutation n'a RIEN changé — la sonde est périmée (motif introuvable dans le fichier réel), pas la porte.`,
      );
    }
    return { ...contenus, [fichier]: mute };
  }

  /** Critère A/AA réellement statué : dérivé du document, jamais écrit en dur. */
  const cible = critereStatues(contenus[DOC]).find((s) =>
    CRITERES_22.some((c) => c.id === s.id && c.niveau !== 'AAA'),
  );
  if (cible === undefined) {
    throw new Error(
      'autotest : aucun critère de la cible n’est statué — les sondes ne prouveraient rien.',
    );
  }

  /** @type {{ nom: string, constats: string[], attendu: string }[]} */
  const sondes = [];

  sondes.push({
    nom: 'tag wcag22aa retiré de l’audit',
    constats: verifier(
      muter(AUDIT, (t) => t.replace(/,\s*'wcag22aa'/, ''), 'tag retiré'),
    ),
    attendu: 'ne contiennent pas « wcag22aa »',
  });

  sondes.push({
    nom: 'audit ramené au desktop seul',
    constats: verifier(
      muter(
        AUDIT,
        (t) => t.replace('test.use(PIXEL_5)', 'test.use({})'),
        'mobile retiré',
      ),
    ),
    attendu: "aucun bloc n'audite une largeur sous 768 px",
  });

  sondes.push({
    nom: 'cible ramenée à 2.1 dans la doc',
    constats: verifier(
      muter(
        DOC,
        (t) => t.replace('la cible passe à WCAG 2.2 AA', 'la cible reste 2.1'),
        'cible rétrogradée',
      ),
    ),
    attendu: "la cible WCAG 2.2 AA n'est plus annoncée",
  });

  sondes.push({
    nom: 'un critère de la cible cesse d’être statué',
    constats: verifier(
      muter(
        DOC,
        (t) => t.replace(`**${cible.id}**`, `**9.9.9**`),
        'critère effacé',
      ),
    ),
    attendu: `le critère WCAG 2.2 ${cible.id}`,
  });

  sondes.push({
    nom: 'un critère étranger est inventé',
    constats: verifier(
      muter(
        DOC,
        (t) => t.replace(`**${cible.id}**`, `**9.9.9**`),
        'critère inventé',
      ),
    ),
    attendu: "n'appartient pas aux neuf nouveautés",
  });

  sondes.push({
    nom: 'une garde citée est renommée',
    constats: verifier(
      muter(
        DOC,
        (t) => t.replace(/Garde : `([^`]+)`/, 'Garde : `$1 (renommée)`'),
        'garde renommée',
      ),
    ),
    attendu: "n'existe dans aucun test de apps/web",
  });

  sondes.push({
    nom: 'un verdict de la cible est vidé',
    constats: verifier(
      muter(DOC, (t) => t.replace('| ✅ conforme', '|  '), 'verdict vidé'),
    ),
    attendu: 'ne porte pas de verdict tranché',
  });

  let echecs = 0;
  for (const sonde of sondes) {
    const mord = sonde.constats.some((c) => c.includes(sonde.attendu));
    if (mord) {
      console.log(`Sonde « ${sonde.nom} » : la porte mord. ✅`);
    } else {
      echecs += 1;
      console.error(
        `Sonde « ${sonde.nom} » : la porte n'a RIEN vu (attendu : ${sonde.attendu}). Elle ne mord plus.`,
      );
    }
  }
  return echecs === 0 ? 0 : 1;
}

function principal() {
  /** @type {Record<string, string>} */
  const contenus = {};
  for (const fichier of FICHIERS) {
    contenus[fichier] = lire(fichier);
  }

  if (process.argv.includes('--autotest')) {
    return autotest(contenus);
  }

  const constats = verifier(contenus);
  if (constats.length > 0) {
    console.error(`Cible WCAG 2.2 AA — ${constats.length} constat(s) :`);
    for (const constat of constats) {
      console.error(`  - ${constat}`);
    }
    return 1;
  }

  const statues = critereStatues(contenus[DOC]);
  const dansCible = CRITERES_22.filter((c) => c.niveau !== 'AAA').length;
  const gardes = gardesCitees(contenus[DOC]).length;
  console.log(
    `Cible WCAG 2.2 AA : ${statues.length} critère(s) statué(s) dont ${dansCible} dans la cible (A/AA), ` +
      `${gardes} garde(s) citée(s) et retrouvée(s) dans les tests, audit axe taggé wcag22aa et joué aussi sous 768 px.`,
  );
  return 0;
}

process.exitCode = principal();
