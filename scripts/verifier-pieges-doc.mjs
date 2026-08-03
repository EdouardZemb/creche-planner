#!/usr/bin/env node
// @ts-check
/**
 * Refuse la recopie, dans les plans et la documentation, d'un piège de boucle de
 * dev que l'outillage rend désormais impossible (lot B7 du chantier
 * « Consolidation UI & qualité »).
 *
 * ## Pourquoi ce script existe
 *
 * L'audit dev de 2026-07-29 a compté **les mêmes cinq pièges recopiés dans une
 * dizaine de plans** : worktree « faux vert », symlinks `workspace:*` cassés,
 * `nx test web` qui ne type-checkait pas, builds de libs préalables, shims
 * `.bin` périmés. Les lots B1 (`pnpm preflight`) et B2 (`dependsOn` réels) les
 * ont **neutralisés** ; il restait à purger la prose, ce que fait le commit qui
 * introduit ce script.
 *
 * Purger une fois ne tient pas : la prose d'un nouveau plan est écrite en
 * recopiant la section « transverses » du plan précédent — c'est exactement
 * comme cela que ces cinq pièges se sont propagés. Le seul état stable est une
 * **porte** : un piège mort qui reparaît dans un document échoue en CI, avec le
 * pointeur vers la phrase à écrire à la place.
 *
 * ## Ce que le script NE fait pas
 *
 * Il ne juge pas la véracité d'une phrase, il constate la **présence d'un motif
 * connu pour être mort**. Un piège encore réel n'a donc rien à craindre : il
 * n'est pas au registre, et la frontière est tracée motif par motif ci-dessous.
 * Elle est fine, et elle a bougé pendant l'écriture de ce script : « builder les
 * libs d'abord » n'était mort que sur `test`/`typecheck`/`e2e`/`build` (arête
 * `^build` posée par B2), le chemin Vite dev (`serve`/`dev`/`preview`) étant
 * resté sans arête — donc encore vrai. Plutôt que d'inscrire l'exception au
 * registre, le lot a posé l'arête manquante : le piège est mort partout.
 *
 * ## Périmètre
 *
 * Plans (`.claude/plans/`), documentation (`docs/`) et documents de racine —
 * c'est-à-dire tout ce qui **instruit un travail futur**. `.claude/memory/`
 * en est volontairement exclu : ces fiches sont des relevés datés (« voici ce
 * qu'a coûté l'incident du 28/07 »), et le dossier n'est qu'un miroir
 * délibérément incomplet d'un magasin local (cf. CLAUDE.md) — une porte de CI
 * qui l'arbitre se battrait contre sa source.
 *
 * ## Deux échappatoires, toutes deux visibles en revue
 *
 * 1. **Le barré `~~…~~`** : la convention du dépôt pour conserver un énoncé
 *    périmé à côté de sa version corrigée (« ~~B3 — …~~ (énoncé d'origine) »).
 *    L'unité barrée est lue comme un relevé, pas comme une consigne. Elle est
 *    fine — la PUCE, pas le bloc : voir `unites()` pour pourquoi cette nuance
 *    est ce qui décide de la portée réelle de l'échappatoire.
 * 2. **Le registre `EXCEPTIONS`** ci-dessous, une entrée par couple
 *    (fichier, piège) avec son motif écrit. Comme `lint-baseline.json`, il est
 *    versionné : l'élargir demande un diff que quelqu'un relit.
 *
 * ## Usage
 *   pnpm pieges               # ou : node scripts/verifier-pieges-doc.mjs
 *
 * ## Contraintes de conception
 *  - Aucune conclusion « par défaut » : si le balayage ne lit aucun document ou
 *    si la section canonique visée par les remèdes a disparu, le script ÉCHOUE
 *    au lieu de rendre « rien à signaler » (un balayage à vide est indiscernable
 *    d'un succès — piège vécu au lot C1).
 *  - Lectures `fs` en `try/catch` seul, jamais un `existsSync()` suivi d'un
 *    `readFileSync()` : ce couple est la fenêtre TOCTOU que la règle CodeQL
 *    `js/file-system-race` (HIGH, bloquante en CI) refuse.
 */

import fs from 'node:fs';
import path from 'node:path';

const RACINE = path.resolve(import.meta.dirname, '..');

/**
 * Où vit la phrase à écrire À LA PLACE d'un piège mort. Le script vérifie que
 * cette section existe : sans elle, tous ses remèdes pointeraient dans le vide.
 */
const SOURCE_CANONIQUE = {
  fichier: 'CONTRIBUTING.md',
  ancre: '## Pièges : ce que l’outillage garantit',
};

/**
 * @typedef {object} PiegeMort
 * @property {string} id            Identifiant court, cité dans les EXCEPTIONS.
 * @property {string} titre         Le piège, en une ligne.
 * @property {RegExp[]} tous        Motifs qui doivent TOUS apparaître dans le paragraphe.
 * @property {RegExp[]} [aucun]     Motifs qui, s'ils apparaissent, disqualifient le constat.
 * @property {string} mort          Ce qui l'a tué (lot + mécanisme), pour le message d'erreur.
 * @property {string} remplacement  Ce qu'il faut écrire à la place.
 */

/**
 * Les pièges neutralisés. Un motif est un couple « tous les termes présents
 * dans le même paragraphe » plutôt qu'une phrase exacte : la prose est
 * enveloppée à la main dans ce dépôt, et chaque plan reformule.
 *
 * @type {PiegeMort[]}
 */
const PIEGES_MORTS = [
  {
    id: 'test-sans-typecheck',
    titre: '« `nx test <projet>` ne type-checke pas »',
    // Volontairement centré sur l'AFFIRMATION, pas sur la commande : un
    // `run-many -t typecheck test lint -p a b c` reste une façon normale de
    // lancer trois cibles sur plusieurs projets, et rien n'y est faux. Ce qui
    // est mort, c'est la raison qu'on donnait de l'écrire.
    tous: [/nx test\b/i, /ne\s+\**\s*type-?check/i],
    mort:
      'lot B2 : `test` porte `dependsOn: ["^build", "typecheck"]` ' +
      '(targetDefaults de nx.json + les 7 cibles écrites à la main) — `nx test <projet>` type-checke.',
    remplacement:
      'retirer l’affirmation ; `nx test <projet>` suffit (cf. CONTRIBUTING.md § Pièges).',
  },
  {
    id: 'builds-de-libs-prealables',
    titre:
      '« builder `contracts-kernel`/`shared-semaine` avant les tests ou le type-check »',
    tous: [
      /contracts-kernel|shared-semaine/i,
      /\bbuild(?:er|ez)?\b/i,
      /\bavant\b|\bd['’]abord\b|préalable|prealable/i,
      /\btest|type-?check|serve|dev\b/i,
    ],
    mort:
      'lot B2 pour `test`/`typecheck`/`e2e`/`build`, puis lot B7 pour `serve`/`dev`/`preview` ' +
      '(le chemin Vite dev était resté sans arête) : `^build` est désormais une arête des sept cibles.',
    remplacement:
      'ne rien prescrire : Nx construit les libs dont web dépend avant la cible, y compris pour un `serve`.',
  },
  {
    id: 'worktree-faux-vert',
    titre:
      '« piège worktree : préfixer les chemins, un worktree neuf n’a pas de `node_modules` »',
    tous: [
      /worktree/i,
      /faux vert|préfixer|prefixer|node_modules|clone principal/i,
    ],
    mort:
      'lot B1 : `pnpm preflight` compare `git-dir` à `git-common-dir` (il NOMME le ' +
      'worktree courant) et signale un worktree sans `node_modules`.',
    remplacement: '`pnpm preflight` en début de session.',
  },
  {
    id: 'symlinks-workspace',
    titre:
      '« réparer les symlinks `@creche-planner/*` (`pnpm install --force`, PowerShell) »',
    tous: [/symlink/i, /@creche-planner|workspace:\*|--force|powershell/i],
    mort:
      'lot B1 : `pnpm preflight` vérifie les 51 liens `workspace:*` là où ils vivent ' +
      '(le `node_modules` de CHAQUE projet, jamais la racine).',
    remplacement: '`pnpm preflight` — il nomme le lien manquant.',
  },
  {
    id: 'shims-bin-perimes',
    titre: '« shims `.bin` périmés après un `pnpm install` »',
    tous: [/shims?\b/i, /\.bin\b/],
    mort: 'lot B1 : `pnpm preflight` vérifie que les 192 shims `.bin` pointent une cible existante.',
    remplacement: '`pnpm preflight`.',
  },
  {
    id: 'port-pact-fantome',
    titre:
      '« un process fantôme squatte un port de provider Pact (3995-3999) »',
    tous: [/399[5-9]/, /squatt|fantôme|fantome|orphelin|occupé|occupe\b/i],
    mort: 'lot B1 : `pnpm preflight` refuse de démarrer si un des 5 ports est déjà tenu.',
    remplacement:
      '`pnpm preflight`. ⚠️ le second mode d’échec, MÊME message « provider non prêt ' +
      'après 40000 ms », reste réel : la saturation machine sous `--parallel` — le dire ainsi.',
  },
  {
    id: 'course-dist-typecheck',
    titre:
      '« course `dist/` entre `build` et `typecheck` (ENOTEMPTY puis cascade TS6305) »',
    tous: [/TS6305|ENOTEMPTY/],
    mort:
      'commit `8bd88ff` : les `tsconfig.app.json` émettent dans `./out-tsc/app`, ' +
      'plus dans le `dist/` que webpack efface (`clean: true`).',
    remplacement:
      'rien — il n’y a plus de répertoire partagé entre les deux cibles.',
  },
];

/**
 * Documents dont la nature même est de relater un état daté. Les nommer ici
 * plutôt que de les corriger est un choix : réécrire un journal ou un ADR pour
 * qu'il colle à l'outillage d'aujourd'hui détruirait ce qu'il documente.
 *
 * @type {{ fichier: string, raison: string }[]}
 */
const DOCUMENTS_RELEVES = [
  {
    fichier: SOURCE_CANONIQUE.fichier,
    raison:
      'la source elle-même : elle doit nommer chaque piège mort pour pouvoir dire qu’il est mort.',
  },
  {
    fichier: 'docs/06-etat-davancement.md',
    raison:
      'journal d’avancement : chaque entrée est datée et relate l’état de son jour.',
  },
  {
    fichier: 'docs/adr/0003-decisions-de-toolchain.md',
    raison:
      'ADR : une décision datée, immuable par convention (on la remplace, on ne la réécrit pas).',
  },
];

/**
 * Mentions légitimes d'un piège mort dans un document qui, lui, instruit du
 * travail futur : le plan qui décrit le défaut qu'il a corrigé. Une entrée qui
 * ne correspond plus à rien est signalée (allowlist qui ne pourrit pas).
 *
 * @type {{ fichier: string, piege: string, raison: string }[]}
 */
const EXCEPTIONS = [
  {
    fichier: '.claude/plans/consolidation-ui-et-qualite.md',
    piege: 'builds-de-libs-prealables',
    raison:
      'énoncé du lot B2 (l’arête posée et ce qu’elle remplace) et du lot B7, qui doit nommer le défaut qu’il a trouvé : ce piège était resté VRAI sur `serve`/`dev`/`preview`, restés sans `dependsOn`. Le lot a posé l’arête ; le relevé doit pouvoir le raconter.',
  },
  {
    fichier: '.claude/plans/consolidation-ui-et-qualite.md',
    piege: 'shims-bin-perimes',
    raison:
      'constat d’audit (§ Synthèse, volet Dev) : l’énoncé du problème que le lot B7 résout — il doit énumérer les cinq pièges recopiés.',
  },
  {
    fichier: '.claude/plans/consolidation-ui-et-qualite.md',
    piege: 'worktree-faux-vert',
    raison:
      'énoncé du lot B1 : la liste des 10 vérifications du préflight, dont celle-ci — un lot d’outillage doit nommer ce qu’il rend impossible.',
  },
  {
    fichier: '.claude/plans/consolidation-ui-et-qualite.md',
    piege: 'symlinks-workspace',
    raison:
      'idem B1 — les 51 liens vérifiés, et le piège du `node_modules` racine qu’un préflight naïf manquerait.',
  },
  {
    fichier: '.claude/plans/consolidation-ui-et-qualite.md',
    piege: 'port-pact-fantome',
    raison:
      'deux mentions légitimes : l’incident daté du 28/07 (quatre jours de tests provider rouges) qui a fait naître la vérification du préflight, et la section « Pièges connus » qui doit OPPOSER ce mode d’échec mort au second, encore réel, qui porte le même message (saturation machine sous `--parallel`).',
  },
  {
    fichier: '.claude/plans/consolidation-ui-et-qualite.md',
    piege: 'course-dist-typecheck',
    raison:
      'relevé de l’effet de bord du lot B2 et de son correctif `out-tsc` : le lot doit nommer ce qu’il a cassé puis réparé.',
  },
];

/** @typedef {{ portee: string, message: string, remede?: string }} Constat */

/** @type {Constat[]} */
const erreurs = [];
/** @type {Constat[]} */
const avertissements = [];

/** @param {string} portee @param {string} message @param {string} [remede] */
function erreur(portee, message, remede) {
  erreurs.push(
    remede === undefined ? { portee, message } : { portee, message, remede },
  );
}

/** @param {string} portee @param {string} message @param {string} [remede] */
function avertir(portee, message, remede) {
  avertissements.push(
    remede === undefined ? { portee, message } : { portee, message, remede },
  );
}

/** Lit un fichier texte, ou rend `null` s'il est absent/illisible. */
function lireTexte(chemin) {
  try {
    return fs.readFileSync(chemin, 'utf8');
  } catch {
    return null;
  }
}

/**
 * Liste récursivement les `.md` d'un répertoire. Un `Dirent` évite un `lstat`
 * par entrée (et donc la règle CodeQL `js/file-system-race`).
 *
 * @param {string} relatif
 * @returns {string[]} chemins relatifs à la racine du dépôt
 */
function listerMarkdown(relatif) {
  /** @type {fs.Dirent[]} */
  let entrees;
  try {
    entrees = fs.readdirSync(path.join(RACINE, relatif), {
      withFileTypes: true,
    });
  } catch {
    return [];
  }
  const trouves = [];
  for (const entree of entrees) {
    const chemin = `${relatif}/${entree.name}`;
    if (entree.isDirectory()) trouves.push(...listerMarkdown(chemin));
    else if (entree.name.endsWith('.md')) trouves.push(chemin);
  }
  return trouves;
}

/** Les documents qui instruisent un travail futur (les relevés datés exclus). */
function inventorierDocuments() {
  const racine = [
    'CLAUDE.md',
    'CONTRIBUTING.md',
    'CONVENTIONS.md',
    'README.md',
    'SECURITY.md',
  ];
  const releves = new Set(DOCUMENTS_RELEVES.map((d) => d.fichier));
  return [
    ...listerMarkdown('.claude/plans'),
    ...listerMarkdown('docs'),
    ...racine,
  ]
    .filter((document) => !releves.has(document))
    .sort();
}

/**
 * Découpe un markdown en unités de sens, en gardant le numéro de la première
 * ligne de chacune.
 *
 * Deux contraintes opposées :
 *  - la prose est enveloppée à la main dans ce dépôt, donc une consigne s'étale
 *    sur 2-3 lignes : un balayage ligne à ligne la manquerait (mesuré —
 *    `qualite-etablissements.md` coupe « `nx test web` » et « ne typecheck pas »
 *    sur deux lignes) ;
 *  - mais un découpage au paragraphe (séparé par une ligne vide) agrège une
 *    liste à puces ENTIÈRE en une seule unité. C'était un angle mort réel :
 *    un seul `~~barré~~` dans une liste de 18 puces exemptait les 17 autres,
 *    et masquait ainsi les énoncés B1/B2 du plan de consolidation.
 *
 * L'unité est donc **la puce** (ou la ligne de tableau, ou le paragraphe simple)
 * avec ses lignes de continuation.
 *
 * @param {string} texte
 * @returns {{ ligne: number, contenu: string }[]}
 */
function unites(texte) {
  const lignes = texte.split(/\r?\n/);
  /** Début d'une nouvelle unité : puce, énumération, citation, titre, ligne de tableau. */
  const DEBUT = /^\s*(?:[-*+]\s|\d+[.)]\s|>|#{1,6}\s|\|)/;
  const trouvees = [];
  /** @type {string[]} */
  let courante = [];
  let debut = 1;

  const cloturer = () => {
    if (courante.length > 0)
      trouvees.push({ ligne: debut, contenu: courante.join(' ') });
    courante = [];
  };

  for (let i = 0; i < lignes.length; i += 1) {
    const ligne = lignes[i] ?? '';
    if (ligne.trim() === '') {
      cloturer();
      continue;
    }
    if (DEBUT.test(ligne)) {
      cloturer();
      debut = i + 1;
      courante = [ligne];
      continue;
    }
    if (courante.length === 0) debut = i + 1;
    courante.push(ligne);
  }
  cloturer();
  return trouvees;
}

/**
 * Un paragraphe barré est un énoncé périmé conservé à côté de sa correction
 * (convention du dépôt : « ~~B3 — …~~ (énoncé d'origine) »). C'est un relevé,
 * pas une consigne.
 *
 * @param {string} contenu
 */
function estReleveBarre(contenu) {
  return /~~[^~]+~~/.test(contenu);
}

// ---------------------------------------------------------------------------
// Vérifications
// ---------------------------------------------------------------------------

/** La section canonique visée par tous les remèdes doit exister. */
function verifierSourceCanonique() {
  const texte = lireTexte(path.join(RACINE, SOURCE_CANONIQUE.fichier));
  if (texte === null) {
    erreur(
      SOURCE_CANONIQUE.fichier,
      'fichier introuvable : les remèdes de ce script pointeraient dans le vide.',
      'restaurer le fichier, ou corriger SOURCE_CANONIQUE.',
    );
    return;
  }
  // Comparaison tolérante à l'apostrophe droite comme à la typographique.
  const normalise = (/** @type {string} */ s) => s.replace(/['’]/g, '’');
  if (!normalise(texte).includes(normalise(SOURCE_CANONIQUE.ancre))) {
    erreur(
      SOURCE_CANONIQUE.fichier,
      `section « ${SOURCE_CANONIQUE.ancre} » absente : les remèdes renvoient à une ancre morte.`,
      'restaurer la section, ou mettre SOURCE_CANONIQUE à jour.',
    );
  }
}

/**
 * @param {string[]} documents
 * @returns {{ paragraphesLus: number, constats: number, exceptionsUtilisees: Set<string> }}
 */
function verifierDocuments(documents) {
  let paragraphesLus = 0;
  let constats = 0;
  /** @type {Set<string>} */
  const exceptionsUtilisees = new Set();
  const exemptes = new Set(EXCEPTIONS.map((e) => `${e.fichier}::${e.piege}`));

  for (const document of documents) {
    const texte = lireTexte(path.join(RACINE, document));
    if (texte === null) continue; // fichier de la liste de racine simplement absent
    const blocs = unites(texte);
    paragraphesLus += blocs.length;

    for (const bloc of blocs) {
      if (estReleveBarre(bloc.contenu)) continue;
      for (const piege of PIEGES_MORTS) {
        if (!piege.tous.every((motif) => motif.test(bloc.contenu))) continue;
        if (piege.aucun?.some((motif) => motif.test(bloc.contenu))) continue;
        const cle = `${document}::${piege.id}`;
        if (exemptes.has(cle)) {
          exceptionsUtilisees.add(cle);
          continue;
        }
        constats += 1;
        erreur(
          `${document}:${bloc.ligne}`,
          `piège mort recopié — ${piege.titre}. Mort par ${piege.mort}`,
          `écrire à la place : ${piege.remplacement}`,
        );
      }
    }
  }
  return { paragraphesLus, constats, exceptionsUtilisees };
}

/**
 * Un relevé déclaré mais introuvable est une exemption qui ne protège rien tout
 * en soustrayant un chemin au balayage : une faute de frappe élargirait le trou
 * en silence.
 */
function verifierReleves() {
  for (const { fichier } of DOCUMENTS_RELEVES) {
    if (lireTexte(path.join(RACINE, fichier)) === null) {
      erreur(
        fichier,
        'document déclaré comme relevé daté mais introuvable : l’exemption ne porte sur rien.',
        'corriger le chemin dans DOCUMENTS_RELEVES, ou retirer l’entrée.',
      );
    }
  }
}

/** Une exception qui ne correspond plus à rien est une ligne morte à retirer. */
function verifierExceptions(/** @type {Set<string>} */ utilisees) {
  for (const exception of EXCEPTIONS) {
    const cle = `${exception.fichier}::${exception.piege}`;
    if (!utilisees.has(cle)) {
      avertir(
        exception.fichier,
        `exception « ${exception.piege} » inutile : le piège n’apparaît plus dans ce fichier.`,
        'retirer l’entrée du registre EXCEPTIONS.',
      );
    }
  }
  const connus = new Set(PIEGES_MORTS.map((p) => p.id));
  for (const exception of EXCEPTIONS) {
    if (!connus.has(exception.piege)) {
      erreur(
        exception.fichier,
        `exception sur un piège inconnu « ${exception.piege} » : faute de frappe ?`,
        `identifiants valides : ${[...connus].join(', ')}.`,
      );
    }
  }
}

// ---------------------------------------------------------------------------
// Exécution
// ---------------------------------------------------------------------------

verifierSourceCanonique();
verifierReleves();

const documents = inventorierDocuments();
const { paragraphesLus, constats, exceptionsUtilisees } =
  verifierDocuments(documents);

// Garde anti-balayage-à-vide : ne JAMAIS conclure « rien à signaler » sans avoir lu.
if (documents.length < 10 || paragraphesLus < 100) {
  erreur(
    'balayage',
    `balayage suspect : ${documents.length} document(s), ${paragraphesLus} paragraphe(s) lus. ` +
      'Un balayage à vide est indiscernable d’un succès.',
    'vérifier que `.claude/plans/` et `docs/` sont bien présents dans le clone.',
  );
}

verifierExceptions(exceptionsUtilisees);

console.log('Pièges morts recopiés dans les plans et la documentation');
console.log(
  `  ${documents.length} documents balayés, ${paragraphesLus} paragraphes, ` +
    `${PIEGES_MORTS.length} pièges au registre, ${EXCEPTIONS.length} exceptions déclarées.`,
);

for (const { portee, message, remede } of avertissements) {
  console.log(`\n  AVERTISSEMENT [${portee}] ${message}`);
  if (remede !== undefined) console.log(`    → ${remede}`);
}
for (const { portee, message, remede } of erreurs) {
  console.log(`\n  ERREUR [${portee}] ${message}`);
  if (remede !== undefined) console.log(`    → ${remede}`);
}

console.log(
  `\n  ${erreurs.length} erreur(s), ${avertissements.length} avertissement(s).`,
);

const resume = process.env['GITHUB_STEP_SUMMARY'];
if (resume !== undefined && resume !== '') {
  const lignes = [
    '### Pièges morts dans les plans et la documentation',
    '',
    `${documents.length} documents · ${paragraphesLus} paragraphes · ${PIEGES_MORTS.length} pièges au registre`,
    '',
  ];
  if (constats === 0) {
    lignes.push('Aucun piège neutralisé n’est recopié comme une consigne.');
  } else {
    lignes.push(
      '| Document | Piège recopié | À écrire à la place |',
      '| --- | --- | --- |',
    );
    for (const { portee, message, remede } of erreurs) {
      lignes.push(
        `| \`${portee}\` | ${message.replace(/\|/g, '\\|')} | ${(remede ?? '').replace(/\|/g, '\\|')} |`,
      );
    }
  }
  try {
    fs.appendFileSync(resume, `${lignes.join('\n')}\n`);
  } catch {
    // Un résumé illisible ne doit pas changer le verdict.
  }
}

process.exit(erreurs.length > 0 ? 1 : 0);
