#!/usr/bin/env node
// @ts-check
/**
 * Porte des durées de conservation (`docs/37-registre-des-traitements.md` §3).
 *
 * ## Pourquoi ce script existe
 *
 * La version 1.0 du registre énonçait huit durées. Confrontées au code au moment de les
 * outiller (lot 2b), **deux d'entre elles se sont révélées inapplicables** — non parce
 * qu'elles étaient difficiles, mais parce qu'elles nommaient un point de départ qui
 * n'existe nulle part :
 *
 *   - T1 ancrait la rétention de l'historique versionné sur la « date d'effet de la
 *     version », en visant aussi `correction_journal` — table qui ne porte aucune date
 *     d'effet ;
 *   - T3bis ancrait celle des préférences sur la « dernière modification », sur une table
 *     dont la purge **réabonne** le parent.
 *
 * Écrites en prose, ces lignes se lisaient comme des exigences. Transcrites littéralement
 * en SQL, elles produisaient deux régressions silencieuses. C'est le motif `MO-2` du
 * registre d'améliorations — « l'énoncé se trompe d'endroit au moment de l'exécuter » — à
 * sa troisième occurrence, donc le moment où le dépôt exige une porte plutôt qu'une leçon.
 *
 * ## Ce que la porte garantit
 *
 * Une ligne du §3 marquée outillée (`✅`) doit **nommer son ancre** sous la forme
 * `table.colonne`, et cette colonne doit exister — dans **tous** les services dont le
 * `schema.ts` déclare cette table, pas seulement dans le premier trouvé. L'attendu est
 * donc **dérivé des schémas**, jamais recopié à la main (`MO-3`).
 *
 * ## Ce que la porte NE garantit pas
 *
 *  - Elle ne juge pas la **durée** : trois ans plutôt que cinq est une décision produit.
 *  - Elle ne vérifie pas qu'une purge **appelle** réellement cette colonne — c'est le rôle
 *    des sondes négatives des specs de purge, qui rendent le SQL et l'assertent.
 *  - Elle ne dit rien des lignes marquées écartées (`⛔`), sinon qu'elles ne doivent pas
 *    prétendre à une ancre.
 *
 * ## Usage
 *   pnpm retentions              # vérifie (exit 1 si un constat)
 *   pnpm retentions --autotest   # rejoue la sonde négative (exit 1 si la porte ne mord pas)
 *
 * ## Contraintes de conception
 *  - Aucune dépendance : tourne sur un clone sans `node_modules`.
 *  - Aucune conclusion « par défaut » : un tableau introuvable ou vide ÉCHOUE, au lieu de
 *    rendre « rien à signaler » (un balayage à vide est indiscernable d'un succès).
 *  - Lectures `fs` en `try/catch` seul, jamais un test d'existence suivi d'une lecture
 *    (fenêtre TOCTOU refusée par la règle CodeQL `js/file-system-race`, bloquante en CI).
 */

import fs from 'node:fs';
import path from 'node:path';

const RACINE = path.resolve(import.meta.dirname, '..');
const REGISTRE = 'docs/37-registre-des-traitements.md';
const TITRE_SECTION = '## 3. Durées de conservation';

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

/** Les `schema.ts` des services, dans l'ordre alphabétique de leur application. */
function schemasDesServices() {
  const apps = path.join(RACINE, 'apps');
  /** @type {{ service: string, source: string }[]} */
  const trouves = [];
  let entrees;
  try {
    entrees = fs.readdirSync(apps, { withFileTypes: true });
  } catch (erreur) {
    throw new Error(
      `apps/ illisible : ${/** @type {Error} */ (erreur).message}`,
    );
  }
  for (const entree of entrees.sort((a, b) => a.name.localeCompare(b.name))) {
    if (!entree.isDirectory()) {
      continue;
    }
    const relatif = `apps/${entree.name}/src/database/schema.ts`;
    try {
      trouves.push({
        service: entree.name,
        source: fs.readFileSync(path.join(RACINE, relatif), 'utf8'),
      });
    } catch {
      // Une app sans base (api-gateway, web) n'a pas de schéma : ce n'est pas un défaut.
    }
  }
  if (trouves.length === 0) {
    throw new Error(
      'aucun schema.ts trouvé sous apps/ — la porte ne peut rien vérifier (balayage à vide)',
    );
  }
  return trouves;
}

/**
 * Extrait le corps d'une déclaration `pgTable('<nom>', …)`, du nom de table jusqu'à la
 * parenthèse fermante correspondante. Rend `null` si le service ne déclare pas la table.
 *
 * @param {string} source
 * @param {string} table
 */
function corpsDeTable(source, table) {
  // `pgTable('x', {…})` et `pgTable(\n  'x',\n  {…}\n)` sont la même déclaration : la forme
  // multi-ligne apparaît dès qu'une table gagne un index ou une contrainte.
  const declaration = new RegExp(`pgTable\\(\\s*['"]${table}['"]`).exec(source);
  if (!declaration) {
    return null;
  }
  const ouverture = declaration.index;
  let profondeur = 0;
  for (let i = source.indexOf('(', ouverture); i < source.length; i += 1) {
    const c = source[i];
    if (c === '(') {
      profondeur += 1;
    } else if (c === ')') {
      profondeur -= 1;
      if (profondeur === 0) {
        return source.slice(ouverture, i + 1);
      }
    }
  }
  return null;
}

/**
 * Lit les lignes du tableau du §3 : `| Réf. | Données | Durée | Ancre | État | Pourquoi |`.
 *
 * @param {string} document
 */
function lignesDuTableau(document) {
  const debut = document.indexOf(TITRE_SECTION);
  if (debut === -1) {
    throw new Error(`${REGISTRE} : section « ${TITRE_SECTION} » introuvable`);
  }
  const suite = document.indexOf('\n## ', debut + 1);
  const section = document.slice(debut, suite === -1 ? undefined : suite);
  /** @type {{ ref: string, ancre: string, etat: string }[]} */
  const lignes = [];
  for (const ligne of section.split(/\r?\n/)) {
    if (!ligne.startsWith('|')) {
      continue;
    }
    const cellules = ligne
      .split('|')
      .slice(1, -1)
      .map((c) => c.trim());
    if (cellules.length < 6) {
      continue;
    }
    const [ref, , , ancre, etat] = cellules;
    if (ref === 'Réf.' || /^-+$/.test(ref ?? '')) {
      continue;
    }
    lignes.push({ ref: ref ?? '', ancre: ancre ?? '', etat: etat ?? '' });
  }
  if (lignes.length === 0) {
    throw new Error(
      `${REGISTRE} : le tableau du §3 est vide — la porte ne peut rien vérifier`,
    );
  }
  return lignes;
}

/**
 * @param {string} document
 * @returns {string[]} les constats, vide si tout va bien
 */
function verifier(document) {
  /** @type {string[]} */
  const constats = [];
  const schemas = schemasDesServices();
  let ancresVerifiees = 0;

  for (const { ref, ancre, etat } of lignesDuTableau(document)) {
    const outillee = etat.includes('✅');
    const references = [...ancre.matchAll(/`([a-z_]+)\.([a-z_]+)`/g)];

    if (!outillee) {
      if (references.length > 0) {
        constats.push(
          `${ref} : ligne non outillée (${etat}) mais qui déclare une ancre — une durée écartée ne prétend pas à une colonne`,
        );
      }
      continue;
    }

    // Une ligne outillée peut ne borner aucune table du dépôt (T5 journaux, T6 sauvegardes,
    // portés par l'exploitation) : elle porte alors « — » et sort du périmètre de la porte.
    if (ancre === '—') {
      continue;
    }
    if (references.length === 0) {
      constats.push(
        `${ref} : ligne outillée sans ancre exploitable (« ${ancre} ») — attendu \`table.colonne\``,
      );
      continue;
    }

    for (const [, table, colonne] of references) {
      const declarants = schemas
        .map((s) => ({ ...s, corps: corpsDeTable(s.source, table ?? '') }))
        .filter((s) => s.corps !== null);
      if (declarants.length === 0) {
        constats.push(
          `${ref} : aucun service ne déclare la table \`${table}\` citée en ancre`,
        );
        continue;
      }
      for (const { service, corps } of declarants) {
        if (!new RegExp(`['"\`]${colonne}['"\`]`).test(corps ?? '')) {
          constats.push(
            `${ref} : \`${table}.${colonne}\` absente du schéma de ${service} — la durée nomme une colonne qui n'existe pas`,
          );
        }
      }
      ancresVerifiees += 1;
    }
  }

  if (ancresVerifiees === 0) {
    constats.push(
      'aucune ancre vérifiée : le tableau ne porte plus aucune ligne outillée, ou leur format a changé — la porte ne mord plus',
    );
  }
  return constats;
}

/**
 * Sonde négative. Elle ne recopie pas la ligne fautive : elle prend la **première** ligne
 * outillée du document, quelle qu'elle soit, et rebaptise sa colonne. Une sonde qui visait
 * un littéral s'est déjà périmée en silence dans ce dépôt (`LE-22`, `LE-33`).
 *
 * @param {string} document
 */
function autotest(document) {
  const reference = /\|\s*`([a-z_]+)\.([a-z_]+)`/.exec(document);
  if (!reference) {
    console.error(
      'Sonde impossible : aucune ancre `table.colonne` dans le document.',
    );
    return 1;
  }
  const [motif, table, colonne] = reference;
  const mute = document.replace(
    motif,
    motif.replace(`${table}.${colonne}`, `${table}.colonne_qui_nexiste_pas`),
  );
  if (mute === document) {
    console.error("Sonde impossible : la mutation n'a rien changé.");
    return 1;
  }
  const constats = verifier(mute);
  const mord = constats.some((c) => c.includes('colonne_qui_nexiste_pas'));
  if (!mord) {
    console.error(
      `Sonde négative : la porte n'a PAS vu \`${table}.colonne_qui_nexiste_pas\`. Elle ne mord plus.`,
    );
    return 1;
  }
  console.log(
    `Sonde négative : la porte voit bien une ancre inexistante (${table}.colonne_qui_nexiste_pas). ✅`,
  );
  return 0;
}

function principal() {
  const document = lire(REGISTRE);
  if (process.argv.includes('--autotest')) {
    return autotest(document);
  }
  const constats = verifier(document);
  if (constats.length > 0) {
    console.error(`Durées de conservation — ${constats.length} constat(s) :`);
    for (const constat of constats) {
      console.error(`  - ${constat}`);
    }
    return 1;
  }
  console.log(
    'Durées de conservation : chaque ligne outillée nomme une ancre qui existe dans tous les schémas la déclarant.',
  );
  return 0;
}

process.exitCode = principal();
