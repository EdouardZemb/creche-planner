#!/usr/bin/env node
// @ts-check
/**
 * Traçabilité bidirectionnelle exigence ↔ test : tout identifiant défini par une
 * spécification est nommé par au moins un test, et tout identifiant nommé par un
 * test est défini par une spécification.
 *
 * ## Pourquoi ce script existe
 *
 * ISO/IEC/IEEE 29148 demande d'une exigence qu'elle soit **vérifiable** et
 * **traçable** (doc 35 §2). Ce dépôt le fait déjà, à la main et bien : les cas de
 * test du modèle de coût portent `CT-01..20`, les exigences d'utilisabilité
 * `UT-01..10`, et les suites nomment ces identifiants dans leurs `it(...)`.
 *
 * Ce qui manquait, c'est la liaison : rien ne remarque qu'une spécification
 * gagne un cas que personne n'écrit, ni qu'un test cite un identifiant qui n'est
 * plus défini nulle part. Les deux sens comptent, et pas pour la même raison —
 * le premier laisse un trou de couverture, le second laisse une preuve qui ne
 * prouve plus rien.
 *
 * ## Ce que la porte est, honnêtement
 *
 * Un **cliquet**, pas une découverte : au moment où elle est écrite, les deux
 * familles sont complètes (la numérotation `CT` saute simplement 09 et 19, qui
 * n'existent dans aucune source). Elle ne trouve rien aujourd'hui ; elle
 * empêche le prochain écart.
 *
 * Et elle vérifie la CITATION, pas la pertinence : qu'un test nomme `CT-07` ne
 * dit pas qu'il éprouve ce que `CT-07` décrit. Aucune machine ne le dirait —
 * c'est le travail de la revue, et la limite est assumée.
 *
 * ## Usage
 *   pnpm tracabilite         # ou : node scripts/verifier-tracabilite-doc.mjs
 *
 * ## Contraintes de conception
 *  - Aucune conclusion « par défaut » : une famille dont la spécification
 *    n'apporte AUCUN identifiant, ou dont aucun fichier de test n'est lu, fait
 *    ÉCHOUER le script. Un balayage à vide est indiscernable d'un succès.
 *  - Lectures `fs` en `try/catch` seul, jamais un `existsSync()` suivi d'un
 *    `readFileSync()` : fenêtre TOCTOU refusée par la règle CodeQL
 *    `js/file-system-race` (HIGH, bloquante en CI).
 */

import fs from 'node:fs';
import path from 'node:path';

const RACINE = path.resolve(import.meta.dirname, '..');

/**
 * @typedef {object} Famille
 * @property {string} id            préfixe de l'identifiant (`CT`, `UT`)
 * @property {string} titre         ce que la famille désigne
 * @property {string} specification LE document qui définit les identifiants
 * @property {string[]} sources     racines où chercher les citations en test
 * @property {RegExp} motif         extraction de l'identifiant
 */

/**
 * Les familles tracées. Une seule spécification fait FOI par famille : les
 * autres documents (README, journal d'avancement) ne font que les citer, et
 * prendre leurs mentions pour des définitions rendrait la porte inerte.
 *
 * @type {Famille[]}
 */
const FAMILLES = [
  {
    id: 'CT',
    titre: 'cas de test chiffrés du modèle de coût (PSU/CNAF + ABCM)',
    specification: 'docs/02-modele-de-cout.md',
    sources: ['libs', 'apps'],
    motif: /\bCT-(\d{2})\b/g,
  },
  {
    id: 'UT',
    titre: 'exigences d’utilisabilité ISTQB CT-UT',
    specification: 'docs/11-spec-accessibilite-ct-ut.md',
    sources: ['apps/web'],
    motif: /\bUT-(\d{2})\b/g,
  },
];

/**
 * Fichiers considérés comme des tests (la citation doit vivre dans une preuve).
 * Les DEUX conventions du dépôt comptent, et la liste a été relevée plutôt que
 * devinée : `*.spec.ts` (190 fichiers, backend et libs) et `*.test.tsx` /
 * `*.test.ts` (72 fichiers, web). Une première version omettait `.test.tsx` et
 * accusait 4 exigences d'être sans test alors qu'elles en avaient un — un
 * balayage partiel accuse à tort aussi sûrement qu'il rassure à tort.
 */
const EXTENSIONS_TEST = ['.spec.ts', '.spec.tsx', '.test.ts', '.test.tsx'];

/** @typedef {{ portee: string, message: string, remede?: string }} Constat */

/** @type {Constat[]} */
const erreurs = [];

/** @param {string} portee @param {string} message @param {string} [remede] */
function erreur(portee, message, remede) {
  erreurs.push(
    remede === undefined ? { portee, message } : { portee, message, remede },
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
    return fs.readFileSync(path.join(RACINE, relatif), 'utf8');
  } catch {
    return null;
  }
};

/** Lit un fichier texte, ou rend `null` s'il est absent/illisible. */
function lireTexte(relatif) {
  return lecteur(relatif);
}

/**
 * Liste récursivement les fichiers de test sous une racine.
 *
 * @param {string} relatif
 * @returns {string[]}
 */
function listerTests(relatif) {
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
    if (entree.name === 'node_modules' || entree.name === 'dist') continue;
    const chemin = `${relatif}/${entree.name}`;
    if (entree.isDirectory()) trouves.push(...listerTests(chemin));
    else if (EXTENSIONS_TEST.some((suffixe) => entree.name.endsWith(suffixe)))
      trouves.push(chemin);
  }
  return trouves;
}

/**
 * Les identifiants d'une famille présents dans un texte.
 *
 * @param {string} texte
 * @param {RegExp} motif
 * @returns {Set<string>}
 */
function identifiants(texte, motif) {
  const trouves = new Set();
  const recherche = new RegExp(motif.source, 'g');
  let occurrence;
  while ((occurrence = recherche.exec(texte)) !== null) {
    if (occurrence[0] !== undefined) trouves.add(occurrence[0]);
  }
  return trouves;
}

/**
 * Joue la vérification complète. Réentrant : les constats sont remis à zéro à
 * chaque appel, sans quoi `--autotest` cumulerait ceux d'une sonde sur l'autre.
 *
 * @param {boolean} [silencieux]
 */
function executer(silencieux) {
  erreurs.length = 0;
  let totalDefinis = 0;
  let totalFichiersTest = 0;

  for (const famille of FAMILLES) {
    const specification = lireTexte(famille.specification);
    if (specification === null) {
      erreur(
        famille.specification,
        `spécification illisible — la famille \`${famille.id}\` n’a plus de source de vérité.`,
      );
      continue;
    }

    const definis = identifiants(specification, famille.motif);
    if (definis.size === 0) {
      erreur(
        famille.specification,
        `aucun identifiant \`${famille.id}-xx\` extrait de la spécification — l’extraction est cassée, ou les identifiants ont changé de forme.`,
        'sans définition, la porte ne garde rien : c’est un échec, pas un succès.',
      );
      continue;
    }
    totalDefinis += definis.size;

    const fichiers = famille.sources.flatMap((source) => listerTests(source));
    if (fichiers.length === 0) {
      erreur(
        famille.sources.join(', '),
        `aucun fichier de test lu pour la famille \`${famille.id}\` — le balayage est cassé.`,
      );
      continue;
    }
    totalFichiersTest += fichiers.length;

    /** identifiant → fichiers de test qui le nomment */
    const cites = new Map();
    for (const fichier of fichiers) {
      const contenu = lireTexte(fichier);
      if (contenu === null) continue;
      for (const identifiant of identifiants(contenu, famille.motif)) {
        cites.set(identifiant, [...(cites.get(identifiant) ?? []), fichier]);
      }
    }

    // Sens 1 — une exigence définie que personne n'éprouve.
    for (const identifiant of [...definis].sort()) {
      if (!cites.has(identifiant)) {
        erreur(
          famille.specification,
          `\`${identifiant}\` est défini (${famille.titre}) mais AUCUN test ne le nomme.`,
          `nommer l’identifiant dans le \`it(...)\` qui l’éprouve, sous ${famille.sources.join(' ou ')}.`,
        );
      }
    }

    // Sens 2 — une preuve qui ne prouve plus rien : le test cite un identifiant
    // que la spécification ne définit plus (renuméroté, supprimé, faute de frappe).
    for (const [identifiant, fichiers2] of [...cites].sort()) {
      if (!definis.has(identifiant)) {
        erreur(
          fichiers2[0] ?? '(inconnu)',
          `\`${identifiant}\` est nommé par un test mais n’est défini nulle part dans ${famille.specification}.`,
          'identifiant renuméroté ou supprimé de la spec ? un test qui cite une exigence morte n’atteste plus rien.',
        );
      }
    }

    if (silencieux !== true) {
      console.log(
        `  ${famille.id} : ${definis.size} définis dans ${famille.specification}, ` +
          `${cites.size} cités dans ${fichiers.length} fichiers de test.`,
      );
    }
  }

  if (totalDefinis === 0 || totalFichiersTest === 0) {
    erreur(
      'balayage',
      'aucune famille n’a pu être confrontée — le script n’a rien vérifié.',
    );
  }
}

/** Affiche les constats et fixe le code de sortie. */
function conclure() {
  console.log('');
  for (const c of erreurs) {
    console.log(`  ERREUR [${c.portee}] ${c.message}`);
    if (c.remede !== undefined) console.log(`    → ${c.remede}`);
  }
  console.log(`\n  ${erreurs.length} erreur(s).`);
  process.exitCode = erreurs.length > 0 ? 1 : 0;
}

/**
 * Les sondes : les deux SENS de la traçabilité doivent mordre, sans quoi la
 * porte n'en garde qu'un (AM-21 / LE-08 du registre, doc 34 §5).
 *
 * @type {{ nom: string, fichier: string, abimer: (texte: string) => string, attendu: RegExp }[]}
 */
const SONDES = [
  {
    nom: 'exigence définie que nul test ne nomme',
    fichier: 'docs/02-modele-de-cout.md',
    abimer: (texte) => `${texte}\n- **CT-21** — cas ajouté par la sonde.\n`,
    attendu: /CT-21.*AUCUN test/is,
  },
  {
    nom: 'test citant une exigence disparue',
    fichier: 'docs/11-spec-accessibilite-ct-ut.md',
    // On retire UT-09 de la SPEC : les tests qui le nomment deviennent alors
    // des preuves orphelines — c'est le second sens de la traçabilité.
    abimer: (texte) => texte.replace(/UT-09/g, 'UT-XX'),
    attendu: /UT-09.*n’est défini nulle part|UT-09.*n'est défini nulle part/is,
  },
];

if (process.argv.includes('--autotest')) {
  process.exitCode = autotest();
} else {
  console.log('Traçabilité exigence ↔ test');
  executer();
  conclure();
}

/** Rejoue les sondes ; rend 0 si toutes mordent et si le témoin est vert. */
function autotest() {
  const surDisque = lecteur;
  let echecs = 0;

  executer(true);
  if (erreurs.length > 0) {
    console.error(
      `❌ témoin : l’état réel lève déjà ${erreurs.length} constat(s) — les sondes ne prouveraient rien.`,
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
    const abime = sonde.abimer(origine);
    if (abime === origine) {
      console.error(
        `❌ sonde « ${sonde.nom} » : la mutation n’a rien changé — la ligne visée a bougé.`,
      );
      echecs += 1;
      continue;
    }
    lecteur = (relatif) =>
      relatif === sonde.fichier ? abime : surDisque(relatif);
    executer(true);
    lecteur = surDisque;
    if (erreurs.some((constat) => sonde.attendu.test(constat.message))) {
      console.log(`✅ sonde « ${sonde.nom} » — la porte mord.`);
    } else {
      console.error(
        `❌ sonde « ${sonde.nom} » : aucun constat attendu — la porte ne mord pas.`,
      );
      echecs += 1;
    }
  }

  console.log(`\n${SONDES.length} sonde(s) rejouée(s), ${echecs} échec(s).`);
  return echecs === 0 ? 0 : 1;
}
