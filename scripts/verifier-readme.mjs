#!/usr/bin/env node
// @ts-check
/**
 * Confronte la FRAÎCHEUR du README aux faits que le dépôt produit lui-même :
 * portes câblées en CI, ADR présents, lots livrés du plan en cours,
 * sous-dossiers de `docs/`.
 *
 * ## Pourquoi ce script existe
 *
 * Le 2026-08-14, le PO a posé l'exigence « à chaque PR le README est à jour »,
 * après l'avoir retrouvé avec six chantiers de retard avant la release
 * `0.16.0` (rattrapé en PR #322).
 *
 * La règle mécanique correspondante — « le diff doit toucher `README.md` » —
 * serait du bruit : une PR Dependabot ou un correctif de test n'ont rien à dire
 * au README, et une porte qui crie sur ces PR-là finit contournée. La règle
 * utile est l'autre : quand le dépôt gagne un fait que le README ÉNONCE, le
 * document doit suivre.
 *
 * C'est la forme de `pnpm faits`, dont cette porte est l'extension : ne pas
 * relire le document avec un œil neuf, mais le CONFRONTER à la source. Aucune
 * valeur attendue n'est écrite ici, elles sont toutes lues.
 *
 * ## Constat négatif d'entrée (ce que la porte a trouvé à son premier run)
 *
 * `pnpm faits` était VERT sur un README déjà périmé de deux éléments : la porte
 * `pnpm acteur`, câblée en CI au lot 6 et citée nulle part, et l'`ADR-0008`,
 * écrit au lot 7 alors que le README annonce « 0001 → 0007 ». Le périmètre
 * déclaré de `pnpm faits` était exact (version, projets, ports, chaîne
 * d'outils) ; c'est le document qui énonce plus que ces quatre faits. `MO-1`
 * une fois de plus, et la raison d'être de cette porte-ci.
 *
 * ## Ce que la porte NE peut pas savoir
 *
 * - Elle juge la PRÉSENCE d'un fait, jamais sa PROSE. Le README peut citer
 *   `pnpm acteur` en le décrivant mal : aucune porte ne lit à la place d'un
 *   relecteur.
 * - Les lots ne sont dérivés que des plans dont les titres portent une marque
 *   de clôture (`## Lot 4 … ✅`). Un plan découpé en « Chantier A/B/C » lettrés
 *   (`consolidation-ui-et-qualite.md`) reste hors de son champ — piste `AM-81`.
 * - Elle ne sait rien de ce qui est DÉPLOYÉ, comme `pnpm faits` : le rang du
 *   train et la date de promotion restent des faits humains.
 *
 * ## Usage
 *   pnpm readme               # ou : node scripts/verifier-readme.mjs
 *   pnpm readme --autotest    # rejoue les sondes négatives
 *
 * ## Contraintes de conception
 *  - Aucune conclusion « par défaut » : si une SOURCE devient illisible, ou si
 *    un fait n'est plus énoncé nulle part dans le README, le script ÉCHOUE. Un
 *    fait qui disparaît du document est indiscernable d'un fait juste (leçon
 *    des lots D6/D8, reprise de `verifier-faits-doc.mjs`).
 *  - Toute mutation de sonde passe par `muter()`, qui LÈVE si le texte est
 *    inchangé : une sonde qui ne mute rien accuse la porte (`LE-42`).
 *  - Lectures `fs` en `try/catch` seul, jamais `existsSync()` puis
 *    `readFileSync()` (fenêtre TOCTOU refusée par CodeQL `js/file-system-race`).
 */

import fs from 'node:fs';
import path from 'node:path';

const RACINE = path.resolve(import.meta.dirname, '..');
const README = 'README.md';

/**
 * Sous-commandes natives de pnpm : `pnpm <mot>` ne désigne alors aucun script
 * du dépôt, et l'absence d'entrée dans `package.json` n'est pas un défaut.
 */
const SOUS_COMMANDES_PNPM = new Set([
  'add',
  'audit',
  'dlx',
  'exec',
  'install',
  'link',
  'list',
  'ls',
  'nx',
  'outdated',
  'remove',
  'run',
  'store',
  'update',
  'why',
]);

/** @typedef {{ portee: string, code: string, message: string, remede?: string }} Constat */

/** @type {Constat[]} */
const erreurs = [];
/** Faits effectivement confrontés à leur source : garde anti-balayage-à-vide. */
const faitsVerifies = new Set();

/** @param {string} portee @param {string} code @param {string} message @param {string} [remede] */
function erreur(portee, code, message, remede) {
  erreurs.push(
    remede === undefined
      ? { portee, code, message }
      : { portee, code, message, remede },
  );
}

/**
 * Lecteur de fichiers, INJECTABLE : `--autotest` le remplace pour abîmer une
 * source en mémoire. Le disque n'est jamais modifié par une sonde.
 *
 * @type {(relatif: string) => string | null}
 */
let lecteur = (relatif) => {
  try {
    // Fins de ligne NORMALISÉES à la lecture. Sous Windows (`core.autocrlf`)
    // tout l'arbre de travail est en CRLF, et `\r` est un terminateur de ligne
    // pour JavaScript : `.` ne le traverse pas, donc un `(.*)$` cesse
    // silencieusement de matcher — la porte lit alors zéro titre de lot et se
    // croit face à un dépôt sans chantier. Même famille que `LE-30`/`LE-42`,
    // et c'est exactement ce qui est arrivé au premier run de ce script.
    return fs
      .readFileSync(path.join(RACINE, relatif), 'utf8')
      .replace(/\r\n/g, '\n');
  } catch {
    return null;
  }
};

/** Lit un fichier texte, ou rend `null` s'il est absent/illisible. */
function lireTexte(relatif) {
  return lecteur(relatif);
}

/** Lit un JSON, ou rend `null`. */
function lireJson(relatif) {
  const brut = lireTexte(relatif);
  if (brut === null) return null;
  try {
    return JSON.parse(brut);
  } catch {
    return null;
  }
}

/**
 * Liste les entrées d'un répertoire (non récursif).
 *
 * @param {string} relatif
 * @returns {fs.Dirent[]}
 */
function entrees(relatif) {
  try {
    return fs.readdirSync(path.join(RACINE, relatif), { withFileTypes: true });
  } catch {
    return [];
  }
}

/**
 * Les numéros couverts par un texte : les entiers cités tels quels (`0008`) et
 * ceux qu'une plage englobe (`0001 → 0008`). Un dépôt qui énumère et un dépôt
 * qui abrège sont tous deux lisibles ; c'est l'ensemble couvert qui compte.
 *
 * @param {string} texte
 * @returns {Set<number>}
 */
function numerosCouverts(texte) {
  /** @type {Set<number>} */
  const couverts = new Set();
  const restant = texte.replace(
    /(0\d{3})\s*(?:→|->|–|—)\s*(0\d{3})/g,
    (_tout, debut, fin) => {
      for (let n = Number(debut); n <= Number(fin); n += 1) couverts.add(n);
      return ' ';
    },
  );
  const seul = /\b(0\d{3})\b/g;
  let trouve;
  while ((trouve = seul.exec(restant)) !== null) {
    couverts.add(Number(trouve[1]));
  }
  return couverts;
}

// ---------------------------------------------------------------------------
// Fait 1 — toute porte jouée par le job `ci` est citée dans le README.
// ---------------------------------------------------------------------------

/**
 * Les portes câblées : les `scripts/verifier-*.mjs` que `ci.yml` exécute,
 * rendus par leur alias `pnpm <nom>` tel que `package.json` le déclare.
 * L'attendu est donc dérivé DEUX fois — du workflow et du manifeste — jamais
 * d'une liste tenue à la main dans ce fichier.
 *
 * @returns {{ alias: string, script: string }[] | null}
 */
function portesCablees() {
  const ci = lireTexte('.github/workflows/ci.yml');
  if (ci === null) {
    erreur(
      '.github/workflows/ci.yml',
      'source-illisible',
      'workflow illisible — impossible de savoir quelles portes tournent en CI.',
    );
    return null;
  }
  const paquet = lireJson('package.json');
  const scripts = paquet?.scripts;
  if (scripts === undefined || scripts === null) {
    erreur(
      'package.json',
      'source-illisible',
      'aucun bloc `scripts` lu — impossible de nommer les portes par leur alias `pnpm`.',
    );
    return null;
  }

  /** @type {Map<string, string>} commande → alias */
  const parCommande = new Map();
  for (const [alias, commande] of Object.entries(scripts)) {
    if (typeof commande === 'string') parCommande.set(commande.trim(), alias);
  }

  /** @type {Map<string, string>} script → alias */
  const cablees = new Map();
  const motif = /node\s+(scripts\/verifier-[a-z0-9-]+\.mjs)/g;
  let trouve;
  while ((trouve = motif.exec(ci)) !== null) {
    const script = trouve[1];
    if (script === undefined || cablees.has(script)) continue;
    const alias = parCommande.get(`node ${script}`);
    if (alias === undefined) {
      erreur(
        'package.json',
        'porte-sans-alias',
        `\`${script}\` est jouée par le job \`ci\` mais aucun script de \`package.json\` ne l'appelle : la porte n'a pas de nom \`pnpm\` à citer.`,
        'ajouter la ligne `"<nom>": "node ' +
          script +
          '"` — c\'est ce nom que le README et CONTRIBUTING citent.',
      );
      continue;
    }
    cablees.set(script, alias);
  }

  return [...cablees].map(([script, alias]) => ({ alias, script }));
}

/** Les alias `pnpm <mot>` cités par le README (blocs de code inclus). */
function aliasCites(readme) {
  /** @type {Set<string>} */
  const cites = new Set();
  const motif = /\bpnpm ([a-z][a-z0-9:_-]*)/g;
  let trouve;
  while ((trouve = motif.exec(readme)) !== null) {
    if (trouve[1] !== undefined) cites.add(trouve[1]);
  }
  return cites;
}

function verifierPortes() {
  const portes = portesCablees();
  if (portes === null || portes.length === 0) {
    if (portes !== null) {
      erreur(
        '.github/workflows/ci.yml',
        'balayage-vide',
        'aucune porte `scripts/verifier-*.mjs` lue dans le workflow — l’analyse est cassée ou le workflow a changé de forme.',
      );
    }
    return;
  }
  const readme = lireTexte(README);
  if (readme === null) {
    erreur(README, 'source-illisible', 'document illisible.');
    return;
  }
  faitsVerifies.add('portes-citees');

  const cites = aliasCites(readme);
  for (const { alias, script } of portes) {
    if (cites.has(alias)) continue;
    erreur(
      README,
      'porte-non-citee',
      `la porte \`pnpm ${alias}\` (${script}) est un step bloquant du job \`ci\` et n'est citée nulle part.`,
      'l’ajouter à la liste des portes de la section « Qualité & CI », avec ce qu’elle garantit en une ligne.',
    );
  }

  // Réciproque : un alias cité qui n'existe plus est une porte renommée ou
  // retirée dont la ligne a survécu — le symétrique de la sonde des projets
  // fantômes de `pnpm faits`.
  const paquet = lireJson('package.json');
  const declares = new Set(Object.keys(paquet?.scripts ?? {}));
  for (const alias of cites) {
    if (declares.has(alias) || SOUS_COMMANDES_PNPM.has(alias)) continue;
    erreur(
      README,
      'commande-fantome',
      `\`pnpm ${alias}\` est cité, mais ni \`package.json\` ni pnpm ne connaissent cette commande.`,
      'commande renommée ou retirée ? sinon, l’inscrire dans `SOUS_COMMANDES_PNPM` de ce script.',
    );
  }
}

// ---------------------------------------------------------------------------
// Fait 2 — les ADR présents dans `docs/adr/` sont tous annoncés par le README.
// ---------------------------------------------------------------------------

/** @returns {number[]} les numéros des ADR réellement présents, triés */
function adrReels() {
  return entrees('docs/adr')
    .filter((e) => e.isFile() && /^\d{4}-.*\.md$/.test(e.name))
    .map((e) => Number(e.name.slice(0, 4)))
    .sort((a, b) => a - b);
}

/**
 * La ligne du tableau « Documentation de pilotage » dont la première cellule
 * pointe le dossier des ADR : c'est elle qui les annonce en un coup d'œil.
 *
 * @returns {{ ligne: string, description: string } | null}
 */
function ligneAdr(readme) {
  for (const ligne of readme.split('\n')) {
    if (!/^\|/.test(ligne)) continue;
    const cellules = ligne.split('|');
    const premiere = cellules[1] ?? '';
    if (!/\]\(docs\/adr\/\)/.test(premiere)) continue;
    return { ligne, description: cellules[2] ?? '' };
  }
  return null;
}

function verifierAdr() {
  const reels = adrReels();
  if (reels.length === 0) {
    erreur(
      'docs/adr/',
      'source-illisible',
      'aucun ADR lu — le balayage est cassé (un fichier `NNNN-*.md` par décision est la convention).',
    );
    return;
  }
  const readme = lireTexte(README);
  if (readme === null) return;

  const ligne = ligneAdr(readme);
  if (ligne === null) {
    erreur(
      README,
      'adr-ligne-absente',
      'aucune ligne de tableau ne pointe `docs/adr/` — le fait a disparu du document, et la porte ne garde plus rien.',
      'la table « Documentation de pilotage » porte une ligne `| [ADR](docs/adr/) | 0001 → NNNN : … |`.',
    );
    return;
  }
  faitsVerifies.add('adr-cites');

  // Un ADR compte comme annoncé s'il est couvert par la ligne dédiée OU lié
  // directement ailleurs dans le document (les deux formes existent déjà).
  const liens = [...readme.matchAll(/docs\/adr\/(\d{4})-/g)].map((m) =>
    Number(m[1]),
  );
  const couverts = numerosCouverts(ligne.description);
  for (const numero of liens) couverts.add(numero);

  for (const numero of reels) {
    if (couverts.has(numero)) continue;
    const nom =
      entrees('docs/adr').find((e) =>
        e.name.startsWith(String(numero).padStart(4, '0')),
      )?.name ?? '';
    erreur(
      README,
      'adr-non-cite',
      `l'ADR \`${nom}\` n'est annoncé nulle part (numéro ${String(numero).padStart(4, '0')} hors de la ligne ADR et sans lien direct).`,
      'étendre la plage de la ligne ADR et y ajouter son intitulé court.',
    );
  }
  for (const numero of couverts) {
    if (reels.includes(numero)) continue;
    erreur(
      README,
      'adr-fantome',
      `le numéro d'ADR ${String(numero).padStart(4, '0')} est annoncé, mais aucun fichier \`docs/adr/${String(numero).padStart(4, '0')}-*.md\` n'existe.`,
      'ADR renuméroté ou jamais écrit ? corriger la plage.',
    );
  }

  // La plage seule se met à jour sans rien dire du contenu : le nombre
  // d'intitulés séparés par `·` doit suivre le nombre d'ADR. Comptage seul —
  // la porte ne juge pas la prose, elle refuse qu'un ADR entre sans un mot.
  const separateur = ligne.description.indexOf(' : ');
  if (separateur === -1) {
    erreur(
      README,
      'adr-intitules',
      'la ligne ADR ne sépare pas la plage de ses intitulés (forme attendue : `0001 → NNNN : intitulé · intitulé …`).',
      'garder la forme : c’est elle qui permet de compter les intitulés.',
    );
    return;
  }
  const intitules = ligne.description
    .slice(separateur + 3)
    .split('·')
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
  if (intitules.length !== reels.length) {
    erreur(
      README,
      'adr-intitules',
      `la ligne ADR porte ${intitules.length} intitulé(s) pour ${reels.length} ADR présents.`,
      'un ADR ajouté prend aussi son intitulé court, séparé par « · » — la plage seule ne dit pas ce qui a été décidé.',
    );
  }
}

// ---------------------------------------------------------------------------
// Fait 3 — les lots livrés du chantier en cours sont ceux que le README relate.
// ---------------------------------------------------------------------------

/**
 * Les lots d'un plan, groupés par NUMÉRO. Un lot scindé (`2a`/`2b`) n'est livré
 * que si toutes ses feuilles le sont : le titre parent, lui, ne porte jamais de
 * marque — c'est le découpage réel du plan des standards.
 *
 * @param {string} contenu
 * @returns {{ livres: Set<number>, ouverts: Set<number> }}
 */
function lotsDuPlan(contenu) {
  /** @type {Map<number, { id: string, clos: boolean }[]>} */
  const groupes = new Map();
  for (const ligne of contenu.split('\n')) {
    const titre = /^#{2,4}\s+Lot\s+(\d+[a-z]?)\b(.*)$/.exec(ligne);
    if (titre === null || titre[1] === undefined) continue;
    const id = titre[1];
    const numero = Number(/^\d+/.exec(id)?.[0]);
    const clos = /✅/.test(titre[2] ?? '');
    groupes.set(numero, [...(groupes.get(numero) ?? []), { id, clos }]);
  }

  const livres = new Set();
  const ouverts = new Set();
  for (const [numero, titres] of groupes) {
    // Feuille : aucun autre titre du groupe ne prolonge son identifiant.
    const feuilles = titres.filter(
      (t) =>
        !titres.some((autre) => autre.id !== t.id && autre.id.startsWith(t.id)),
    );
    if (feuilles.length > 0 && feuilles.every((f) => f.clos))
      livres.add(numero);
    else ouverts.add(numero);
  }
  return { livres, ouverts };
}

/** Les numéros de lots cités par une ligne du README (`lots 0 → 5, 7`). */
function lotsCites(ligne) {
  const liste =
    /lots?\s+(\d+(?:\s*(?:→|->|–|—)\s*\d+)?(?:\s*,\s*\d+(?:\s*(?:→|->|–|—)\s*\d+)?)*)/.exec(
      ligne,
    );
  if (liste === null || liste[1] === undefined) return null;
  const cites = new Set();
  for (const morceau of liste[1].split(',')) {
    const plage = /(\d+)\s*(?:→|->|–|—)\s*(\d+)/.exec(morceau);
    if (plage !== null) {
      for (let n = Number(plage[1]); n <= Number(plage[2]); n += 1)
        cites.add(n);
      continue;
    }
    const seul = /(\d+)/.exec(morceau);
    if (seul !== null) cites.add(Number(seul[1]));
  }
  return cites;
}

/** Rend l'ensemble trié sous la forme la plus courte qui le décrive. */
function enumerer(numeros) {
  return [...numeros].sort((a, b) => a - b).join(', ');
}

function verifierLots() {
  const plans = entrees('.claude/plans')
    .filter((e) => e.isFile() && e.name.endsWith('.md'))
    .map((e) => `.claude/plans/${e.name}`);
  if (plans.length === 0) {
    erreur(
      '.claude/plans/',
      'source-illisible',
      'aucun plan lu — le balayage est cassé.',
    );
    return;
  }
  const readme = lireTexte(README);
  if (readme === null) return;

  /** @type {{ plan: string, livres: Set<number>, ouverts: Set<number> }[]} */
  const enCours = [];
  for (const plan of plans) {
    const contenu = lireTexte(plan);
    if (contenu === null) continue;
    const { livres, ouverts } = lotsDuPlan(contenu);
    if (livres.size > 0 && ouverts.size > 0) {
      enCours.push({ plan, livres, ouverts });
    }
  }
  if (enCours.length === 0) {
    erreur(
      '.claude/plans/',
      'balayage-vide',
      'aucun plan « en cours » (au moins un lot livré et un lot ouvert) — soit tous les chantiers sont clos, soit la marque de clôture des titres a changé de forme et la porte ne garde plus rien.',
      'un titre de lot livré porte `✅` (ex. `## Lot 4 — … ✅ LIVRÉ`).',
    );
    return;
  }
  faitsVerifies.add('lots-livres');

  const lignes = readme.split('\n');
  for (const { plan, livres } of enCours) {
    const ligne = lignes.find((l) => l.includes(plan));
    if (ligne === undefined) {
      erreur(
        README,
        'plan-non-lie',
        `le chantier en cours \`${plan}\` (lots livrés : ${enumerer(livres)}) n'est lié nulle part.`,
        'lui donner sa ligne dans la table des chantiers de « État du projet », avec le lien vers le plan et les lots livrés.',
      );
      continue;
    }
    const cites = lotsCites(ligne);
    if (cites === null) {
      erreur(
        README,
        'lots-non-cites',
        `la ligne qui lie \`${plan}\` ne cite aucun lot (forme attendue : « lots 0 → 5 », ou « lots 0 → 5, 7 »).`,
        `lots livrés à ce jour : ${enumerer(livres)}.`,
      );
      continue;
    }
    const manquants = [...livres].filter((n) => !cites.has(n));
    const surplus = [...cites].filter((n) => !livres.has(n));
    if (manquants.length > 0) {
      erreur(
        README,
        'lot-livre-non-relate',
        `\`${plan}\` : le(s) lot(s) ${enumerer(manquants)} sont livrés et la ligne du README ne les couvre pas (elle annonce ${enumerer(cites)}).`,
        `porter la plage à « lots ${enumerer(livres)} » et compléter la colonne « Livré » avec ce que le lot a apporté.`,
      );
    }
    if (surplus.length > 0) {
      erreur(
        README,
        'lot-annonce-non-livre',
        `\`${plan}\` : la ligne annonce le(s) lot(s) ${enumerer(surplus)}, qui ne sont pas marqués livrés dans le plan.`,
        'le README annonce en avance de phase : corriger la plage, ou clore le lot dans le plan.',
      );
    }
  }
}

// ---------------------------------------------------------------------------
// Fait 4 — les sous-dossiers de `docs/` sont annoncés par le README.
// ---------------------------------------------------------------------------

function verifierSectionsDocs() {
  const sousDossiers = entrees('docs')
    .filter((e) => e.isDirectory())
    .map((e) => e.name)
    .sort();
  if (sousDossiers.length === 0) {
    erreur(
      'docs/',
      'source-illisible',
      'aucun sous-dossier de `docs/` lu — le balayage est cassé.',
    );
    return;
  }
  const readme = lireTexte(README);
  if (readme === null) return;
  faitsVerifies.add('sections-docs');

  for (const nom of sousDossiers) {
    if (readme.includes(`docs/${nom}/`)) continue;
    erreur(
      README,
      'section-docs-non-citee',
      `le sous-dossier \`docs/${nom}/\` n'est lié nulle part : un pan entier de la documentation est invisible depuis la porte d'entrée.`,
      'l’annoncer dans « Documentation de pilotage ».',
    );
  }
}

/**
 * Joue les quatre vérifications. Réentrant : constats et faits confrontés sont
 * remis à zéro à chaque appel, sans quoi `--autotest` cumulerait ceux d'une
 * sonde sur l'autre et conclurait juste par accident.
 */
function executer() {
  erreurs.length = 0;
  faitsVerifies.clear();

  verifierPortes();
  verifierAdr();
  verifierLots();
  verifierSectionsDocs();

  const ATTENDUS = [
    'portes-citees',
    'adr-cites',
    'lots-livres',
    'sections-docs',
  ];
  for (const fait of ATTENDUS) {
    if (!faitsVerifies.has(fait)) {
      erreur(
        'balayage',
        'fait-non-confronte',
        `le fait « ${fait} » n'a été confronté à AUCUNE source : sa vérification s'est interrompue.`,
        'un fait non vérifié ne doit jamais se lire comme un fait juste.',
      );
    }
  }
  return { attendus: ATTENDUS.length };
}

/** Affiche les constats et fixe le code de sortie. */
function conclure({ attendus }) {
  console.log(
    `  ${faitsVerifies.size}/${attendus} faits du README confrontés à leur source.\n`,
  );
  for (const c of erreurs) {
    console.log(`  ERREUR [${c.portee}] ${c.message}`);
    if (c.remede !== undefined) console.log(`    → ${c.remede}`);
  }
  console.log(`\n  ${erreurs.length} erreur(s).`);
  process.exitCode = erreurs.length > 0 ? 1 : 0;
}

/**
 * Remplace, ou LÈVE. Une mutation qui ne change rien ferait conclure « la porte
 * ne mord plus » alors que la cible a simplement bougé (`LE-42`).
 *
 * @param {string} texte @param {string | RegExp} avant @param {string} apres
 */
function muter(texte, avant, apres) {
  const mute = texte.replace(avant, apres);
  if (mute === texte) {
    throw new Error(`mutation sans effet : « ${String(avant)} » introuvable`);
  }
  return mute;
}

/**
 * Les sondes : un fait par sonde au moins, parce qu'une porte à quatre faits
 * peut mordre sur l'un et être aveugle sur les trois autres. Chaque cible est
 * DÉRIVÉE de l'état réel, jamais écrite en littéral — une sonde littérale se
 * périme en silence (`LE-22`, `LE-33`).
 *
 * @type {{ nom: string, fichier: string, abimer: (texte: string) => string, code: string }[]}
 */
const SONDES = [
  {
    nom: 'porte de CI absente du README',
    fichier: README,
    abimer: (texte) => {
      const porte = (portesCablees() ?? []).find((p) =>
        new RegExp(`\\bpnpm ${p.alias}\\b`).test(texte),
      );
      if (porte === undefined) throw new Error('aucune porte citée à abîmer');
      return muter(
        texte,
        new RegExp(`\\bpnpm ${porte.alias}\\b`, 'g'),
        `commande ${porte.alias}`,
      );
    },
    code: 'porte-non-citee',
  },
  {
    nom: 'commande fantôme (porte renommée)',
    fichier: README,
    abimer: (texte) => {
      const porte = (portesCablees() ?? []).find((p) =>
        new RegExp(`\\bpnpm ${p.alias}\\b`).test(texte),
      );
      if (porte === undefined) throw new Error('aucune porte citée à abîmer');
      return muter(
        texte,
        new RegExp(`\\bpnpm ${porte.alias}\\b`),
        `pnpm ${porte.alias}-v2`,
      );
    },
    code: 'commande-fantome',
  },
  {
    nom: 'ADR récent hors de la plage annoncée',
    fichier: README,
    abimer: (texte) => {
      const reels = adrReels();
      const dernier = reels[reels.length - 1];
      if (dernier === undefined) throw new Error('aucun ADR réel');
      const cible = String(dernier).padStart(4, '0');
      const precedent = String(dernier - 1).padStart(4, '0');
      // La plage, ET les liens directs s'il y en a — un ADR resté lié ailleurs
      // dans le document est couvert par l'autre voie, et la sonde ne
      // prouverait rien. Le lien direct est facultatif : `muter()` lèverait sur
      // son absence, alors qu'ici elle est un état légitime du document.
      const sansPlage = muter(
        texte,
        new RegExp(`→ ${cible}`),
        `→ ${precedent}`,
      );
      return sansPlage.replace(
        new RegExp(`docs/adr/${cible}-[a-z0-9-]+\\.md`, 'g'),
        'docs/adr/',
      );
    },
    code: 'adr-non-cite',
  },
  {
    nom: 'ADR ajouté sans son intitulé',
    fichier: README,
    abimer: (texte) => {
      const ligne = ligneAdr(texte);
      if (ligne === null) throw new Error('ligne ADR introuvable');
      const intitules = ligne.description.slice(
        ligne.description.indexOf(' : ') + 3,
      );
      const reduit = intitules.replace(/·[^·|]*$/, '');
      if (reduit === intitules) throw new Error('aucun intitulé à retirer');
      return muter(texte, intitules, reduit);
    },
    code: 'adr-intitules',
  },
  {
    nom: 'lot livré non relaté par le README',
    fichier: README,
    abimer: (texte) => {
      const plan = entrees('.claude/plans')
        .map((e) => `.claude/plans/${e.name}`)
        .find((p) => {
          const contenu = lireTexte(p);
          if (contenu === null) return false;
          const { livres, ouverts } = lotsDuPlan(contenu);
          return livres.size > 0 && ouverts.size > 0 && texte.includes(p);
        });
      if (plan === undefined) throw new Error('aucun plan en cours lié');
      const ligne = texte.split('\n').find((l) => l.includes(plan));
      const cites = ligne === undefined ? null : lotsCites(ligne);
      if (ligne === undefined || cites === null) {
        throw new Error('aucun lot cité à abîmer');
      }
      const dernier = Math.max(...cites);
      return muter(
        texte,
        ligne,
        ligne.replace(new RegExp(`(→\\s*)${dernier}\\b`), `$1${dernier - 1}`),
      );
    },
    code: 'lot-livre-non-relate',
  },
  {
    nom: 'chantier en cours non lié',
    fichier: README,
    abimer: (texte) => {
      const plan = entrees('.claude/plans')
        .map((e) => `.claude/plans/${e.name}`)
        .find((p) => texte.includes(p));
      if (plan === undefined) throw new Error('aucun plan lié');
      return muter(texte, new RegExp(plan, 'g'), '.claude/plans/');
    },
    code: 'plan-non-lie',
  },
  {
    nom: 'sous-dossier de docs/ non annoncé',
    fichier: README,
    abimer: (texte) => {
      // Le dernier par ordre alphabétique : `adr/` est déjà couvert par les
      // sondes ADR, viser le même dossier deux fois ne prouverait rien de plus.
      const noms = entrees('docs')
        .filter((e) => e.isDirectory())
        .map((e) => e.name)
        .sort();
      const cible = noms[noms.length - 1];
      if (cible === undefined) throw new Error('aucun sous-dossier de docs/');
      return muter(texte, new RegExp(`docs/${cible}/`, 'g'), 'docs/');
    },
    code: 'section-docs-non-citee',
  },
];

if (process.argv.includes('--autotest')) {
  process.exitCode = autotest();
} else {
  console.log('Fraîcheur du README confrontée aux faits du dépôt');
  conclure(executer());
}

/** Rejoue les sondes ; rend 0 si toutes mordent et si le témoin est vert. */
function autotest() {
  const surDisque = lecteur;
  let echecs = 0;

  executer();
  if (erreurs.length > 0) {
    console.error(
      `❌ témoin : l'état réel lève déjà ${erreurs.length} constat(s) — les sondes ne prouveraient rien.`,
    );
    echecs += 1;
  }

  for (const sonde of SONDES) {
    const origine = surDisque(sonde.fichier);
    if (origine === null) {
      console.error(
        `❌ sonde « ${sonde.nom} » : ${sonde.fichier} illisible — la sonde a perdu sa cible.`,
      );
      echecs += 1;
      continue;
    }
    let abime;
    try {
      abime = sonde.abimer(origine);
    } catch (e) {
      console.error(
        `❌ sonde « ${sonde.nom} » : ${e instanceof Error ? e.message : String(e)} — la cible a bougé.`,
      );
      echecs += 1;
      continue;
    }
    lecteur = (relatif) =>
      relatif === sonde.fichier ? abime : surDisque(relatif);
    executer();
    lecteur = surDisque;
    if (erreurs.some((constat) => constat.code === sonde.code)) {
      console.log(`✅ sonde « ${sonde.nom} » — la porte mord.`);
    } else {
      console.error(
        `❌ sonde « ${sonde.nom} » : aucun constat « ${sonde.code} » — la porte ne mord pas.`,
      );
      echecs += 1;
    }
  }

  console.log(`\n${SONDES.length} sonde(s) rejouée(s), ${echecs} échec(s).`);
  return echecs === 0 ? 0 : 1;
}
