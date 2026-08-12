#!/usr/bin/env node
// @ts-check
/**
 * Porte de complétude de l'export de portabilité
 * (`docs/37-registre-des-traitements.md` §6).
 *
 * ## Pourquoi ce script existe
 *
 * Un export de portabilité se périme d'une façon particulière : il ne casse pas. On
 * ajoute une table, on oublie de l'exporter, et **rien ne le dit** — l'export continue
 * de répondre 200 avec un document qui a l'air complet. C'est le mode de défaillance
 * dominant du dépôt (`MO-1`, huit occurrences) : un outil vert parce qu'il ne regarde
 * pas. Ici il serait pire que vert, il serait *rassurant* : le document affirme rendre
 * les données de la personne.
 *
 * La reconnaissance du lot 3 a mesuré 46 tables sur 5 services. Aucune commande ne
 * savait dire laquelle de ces 46 sortait dans l'export, laquelle était une copie d'une
 * autre, et laquelle n'avait aucune raison d'en être.
 *
 * ## Ce que la porte garantit
 *
 * 1. **Aucune table n'échappe au classement.** L'attendu est **dérivé** des `schema.ts`
 *    des services — chaque `pgTable('…')` doit avoir sa ligne au §6, et une ligne du §6
 *    qui ne correspond à aucune table réelle est un fantôme (table renommée, service
 *    supprimé). C'est la seule façon qu'une table *nouvelle* soit remarquée.
 * 2. **Une table dite `exportée` est réellement lue par le code d'export** de son
 *    service (`apps/<service>/src/portabilite/portabilite.service.ts`). Le lien se fait
 *    par l'identifiant Drizzle (`export const foyerVersion = pgTable('foyer_version')`),
 *    lui aussi dérivé du schéma : ni le nom SQL ni le nom TypeScript ne sont recopiés
 *    ici.
 * 3. **Une table dite `copie` nomme sa source**, sous la forme `service.table`, et cette
 *    source existe et est elle-même `exportée`. C'est le contrôle qui empêche de faire
 *    disparaître une donnée en la déclarant « copie de » quelque chose que personne
 *    n'exporte.
 *
 * ## Ce que la porte NE garantit pas
 *
 *  - Elle ne juge pas le **classement** : décider qu'une table est technique plutôt que
 *    personnelle reste une lecture humaine, inscrite au §6 avec son motif.
 *  - Elle ne vérifie pas les **colonnes** : qu'une table exportée rende toutes ses
 *    colonnes n'est pas constatable ici — l'export projette délibérément (le `jti` d'un
 *    jeton de désabonnement en est retiré, et c'est voulu).
 *  - Elle ne dit rien de ce qui vit **hors base** : journaux, sauvegardes, tiers (§1 T5,
 *    T6, T8).
 *  - Elle ne prouve pas que la route d'export **répond** : c'est le rôle des specs de
 *    service et de l'e2e sur pile réelle.
 *
 * ## Usage
 *   pnpm portabilite              # vérifie (exit 1 si un constat)
 *   pnpm portabilite --autotest   # rejoue les sondes négatives (exit 1 si la porte ne mord pas)
 *
 * ## Contraintes de conception
 *  - Aucune dépendance : tourne sur un clone sans `node_modules`.
 *  - Aucune conclusion « par défaut » : un tableau vide ou un balayage sans table
 *    ÉCHOUE, au lieu de rendre « rien à signaler ».
 *  - Lectures `fs` en `try/catch` seul, jamais un test d'existence suivi d'une lecture
 *    (fenêtre TOCTOU refusée par la règle CodeQL `js/file-system-race`, bloquante en CI).
 */

import fs from 'node:fs';
import path from 'node:path';

const RACINE = path.resolve(import.meta.dirname, '..');
const REGISTRE = 'docs/37-registre-des-traitements.md';
const TITRE_SECTION = "## 6. Ce que l'export de portabilité rend";

/**
 * Rend l'apostrophe typographique et l'apostrophe droite interchangeables. Les deux
 * cohabitent dans la documentation du dépôt, et un titre de section n'a pas à devenir
 * introuvable parce qu'un formateur a changé de guillemet. Substitution caractère pour
 * caractère : les index de la chaîne sont préservés.
 *
 * @param {string} texte
 */
function normaliserApostrophes(texte) {
  return texte.replaceAll('’', "'");
}

const CLASSE_EXPORTEE = 'exportée';
const CLASSE_COPIE = 'copie';
const CLASSES = new Set([
  CLASSE_EXPORTEE,
  CLASSE_COPIE,
  'technique',
  'hors périmètre',
]);

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

/** @param {string} relatif */
function lireSiPresent(relatif) {
  try {
    return fs.readFileSync(path.join(RACINE, relatif), 'utf8');
  } catch {
    return null;
  }
}

/**
 * Univers **dérivé** : toutes les tables déclarées par les services, avec
 * l'identifiant Drizzle qui les porte. C'est cet identifiant, et non le nom SQL, que
 * le code d'export manipule.
 *
 * @returns {{ service: string, table: string, identifiant: string, export: string | null }[]}
 */
function tablesDesServices() {
  const apps = path.join(RACINE, 'apps');
  let entrees;
  try {
    entrees = fs.readdirSync(apps, { withFileTypes: true });
  } catch (erreur) {
    throw new Error(
      `apps/ illisible : ${/** @type {Error} */ (erreur).message}`,
    );
  }
  /** @type {{ service: string, table: string, identifiant: string, export: string | null }[]} */
  const tables = [];
  for (const entree of entrees.sort((a, b) => a.name.localeCompare(b.name))) {
    if (!entree.isDirectory()) {
      continue;
    }
    const schema = lireSiPresent(`apps/${entree.name}/src/database/schema.ts`);
    if (schema === null) {
      // Une app sans base (api-gateway, web) : ce n'est pas un défaut.
      continue;
    }
    const codeExport = lireSiPresent(
      `apps/${entree.name}/src/portabilite/portabilite.service.ts`,
    );
    for (const trouve of schema.matchAll(
      /export const ([A-Za-z0-9_]+)\s*=\s*pgTable\(\s*['"]([a-z0-9_]+)['"]/g,
    )) {
      tables.push({
        service: entree.name,
        table: trouve[2] ?? '',
        identifiant: trouve[1] ?? '',
        export: codeExport,
      });
    }
  }
  if (tables.length === 0) {
    throw new Error(
      'aucune table trouvée sous apps/*/src/database/schema.ts — la porte ne peut rien vérifier (balayage à vide)',
    );
  }
  return tables;
}

/**
 * Lit le tableau du §6 : `| Service | Table | Classe | Pourquoi |`.
 *
 * @param {string} document
 * @returns {{ service: string, table: string, classe: string, pourquoi: string }[]}
 */
function lignesDuTableau(documentBrut) {
  const document = normaliserApostrophes(documentBrut);
  const debut = document.indexOf(TITRE_SECTION);
  if (debut === -1) {
    throw new Error(`${REGISTRE} : section « ${TITRE_SECTION} » introuvable`);
  }
  const suite = document.indexOf('\n## ', debut + 1);
  const section = document.slice(debut, suite === -1 ? undefined : suite);
  /** @type {{ service: string, table: string, classe: string, pourquoi: string }[]} */
  const lignes = [];
  for (const ligne of section.split(/\r?\n/)) {
    if (!ligne.startsWith('|')) {
      continue;
    }
    const cellules = ligne
      .split('|')
      .slice(1, -1)
      .map((c) => c.trim());
    if (cellules.length < 4) {
      continue;
    }
    const [service, table, classe, pourquoi] = cellules;
    if (service === 'Service' || /^-+$/.test(service ?? '')) {
      continue;
    }
    lignes.push({
      service: (service ?? '').replaceAll('`', ''),
      table: (table ?? '').replaceAll('`', ''),
      classe: classe ?? '',
      pourquoi: pourquoi ?? '',
    });
  }
  if (lignes.length === 0) {
    throw new Error(
      `${REGISTRE} : le tableau du §6 est vide — la porte ne peut rien vérifier`,
    );
  }
  return lignes;
}

/** @param {{service: string, table: string}} t */
function cle(t) {
  return `${t.service}.${t.table}`;
}

/**
 * @param {string} document
 * @param {ReturnType<typeof tablesDesServices>} [tablesInjectees] pour la sonde négative
 * @returns {string[]} les constats, vide si tout va bien
 */
function verifier(document, tablesInjectees) {
  /** @type {string[]} */
  const constats = [];
  const tables = tablesInjectees ?? tablesDesServices();
  const lignes = lignesDuTableau(document);

  const parCle = new Map(tables.map((t) => [cle(t), t]));
  const classees = new Map();
  for (const ligne of lignes) {
    const k = cle(ligne);
    if (classees.has(k)) {
      constats.push(`\`${k}\` : classée deux fois au §6`);
      continue;
    }
    classees.set(k, ligne);
  }

  // (1) L'attendu est dérivé des schémas — dans les deux sens.
  for (const table of tables) {
    if (!classees.has(cle(table))) {
      constats.push(
        `\`${cle(table)}\` : table déclarée par le service mais absente du §6 — une table non classée est une table qui peut échapper à l'export sans que rien ne le dise`,
      );
    }
  }
  for (const ligne of lignes) {
    if (!parCle.has(cle(ligne))) {
      constats.push(
        `\`${cle(ligne)}\` : ligne du §6 qui ne correspond à aucune table réelle (renommée ? service supprimé ?)`,
      );
    }
    if (!CLASSES.has(ligne.classe)) {
      constats.push(
        `\`${cle(ligne)}\` : classe « ${ligne.classe} » inconnue — attendu ${[...CLASSES].map((c) => `« ${c} »`).join(', ')}`,
      );
    }
  }

  // (2) Une table dite exportée est réellement lue par le code d'export du service.
  let exporteesVerifiees = 0;
  for (const ligne of lignes) {
    if (ligne.classe !== CLASSE_EXPORTEE) {
      continue;
    }
    const table = parCle.get(cle(ligne));
    if (!table) {
      continue; // déjà signalée comme fantôme
    }
    if (table.export === null) {
      constats.push(
        `\`${cle(ligne)}\` : classée exportée, mais ${ligne.service} n'a aucun apps/${ligne.service}/src/portabilite/portabilite.service.ts`,
      );
      continue;
    }
    if (!new RegExp(`\\b${table.identifiant}\\b`).test(table.export)) {
      constats.push(
        `\`${cle(ligne)}\` : classée exportée, mais le code d'export de ${ligne.service} ne lit jamais \`${table.identifiant}\``,
      );
      continue;
    }
    exporteesVerifiees += 1;
  }

  // (3) Une copie nomme sa source, et cette source est réellement exportée.
  let copiesVerifiees = 0;
  for (const ligne of lignes) {
    if (ligne.classe !== CLASSE_COPIE) {
      continue;
    }
    const source = /`([a-z-]+)\.([a-z0-9_]+)`/.exec(ligne.pourquoi);
    if (!source) {
      constats.push(
        `\`${cle(ligne)}\` : classée copie sans nommer sa source — attendu une référence \`service.table\` dans la colonne « Pourquoi »`,
      );
      continue;
    }
    const cleSource = `${source[1]}.${source[2]}`;
    const ligneSource = classees.get(cleSource);
    if (!ligneSource) {
      constats.push(
        `\`${cle(ligne)}\` : copie de \`${cleSource}\`, qui n'est classée nulle part au §6`,
      );
      continue;
    }
    if (ligneSource.classe !== CLASSE_EXPORTEE) {
      constats.push(
        `\`${cle(ligne)}\` : copie de \`${cleSource}\`, qui n'est pas exportée (« ${ligneSource.classe} ») — la donnée ne sortirait alors par aucun des deux`,
      );
      continue;
    }
    copiesVerifiees += 1;
  }

  if (exporteesVerifiees === 0) {
    constats.push(
      'aucune table exportée vérifiée : le §6 n’en classe plus aucune, ou le format du tableau a changé — la porte ne mord plus',
    );
  }
  if (copiesVerifiees === 0) {
    constats.push(
      'aucune copie vérifiée : le §6 n’en classe plus aucune, ou le format du tableau a changé — la porte ne mord plus',
    );
  }
  return constats;
}

/**
 * Sondes négatives. Aucune ne recopie une table : chacune prend la **première** ligne
 * du genre visé, quelle qu'elle soit, et la mute. Une sonde écrite sur un littéral
 * s'est déjà périmée en silence dans ce dépôt (`LE-22`, `LE-33`).
 *
 * @param {string} document
 */
function autotest(document) {
  const tables = tablesDesServices();
  const lignes = lignesDuTableau(document);
  /** @type {{ nom: string, muter: () => { document: string, tables: typeof tables }, attendu: string }[]} */
  const sondes = [];

  // (a) Une table nouvelle, jamais classée : le cas qui arrive vraiment.
  const modele = tables[0];
  if (modele) {
    sondes.push({
      nom: 'table nouvelle non classée',
      muter: () => ({
        document,
        tables: [
          ...tables,
          {
            service: modele.service,
            table: 'table_jamais_classee',
            identifiant: 'tableJamaisClassee',
            export: modele.export,
          },
        ],
      }),
      attendu: 'table_jamais_classee',
    });
  }

  // (b) Une table classée exportée que le code d'export ne lit pas.
  const exportee = lignes.find((l) => l.classe === CLASSE_EXPORTEE);
  if (exportee) {
    const reelle = tables.find((t) => cle(t) === cle(exportee));
    if (reelle) {
      sondes.push({
        nom: 'table dite exportée que le code ne lit pas',
        muter: () => ({
          document,
          tables: tables.map((t) =>
            cle(t) === cle(exportee)
              ? { ...t, export: '// code d’export vidé par la sonde' }
              : t,
          ),
        }),
        attendu: `ne lit jamais \`${reelle.identifiant}\``,
      });
    }
  }

  // (c) Une copie dont la source n'existe pas.
  const copie = lignes.find((l) => l.classe === CLASSE_COPIE);
  if (copie) {
    const source = /`([a-z-]+)\.([a-z0-9_]+)`/.exec(copie.pourquoi);
    if (source) {
      sondes.push({
        nom: 'copie dont la source n’est classée nulle part',
        muter: () => ({
          document: document.replace(
            source[0],
            '`svc-foyer.table_source_absente`',
          ),
          tables,
        }),
        attendu: 'table_source_absente',
      });
    }
  }

  if (sondes.length < 3) {
    console.error(
      `Sonde impossible : ${sondes.length} sonde(s) constructible(s) sur 3 — le §6 ne porte plus les lignes nécessaires.`,
    );
    return 1;
  }

  let echecs = 0;
  for (const sonde of sondes) {
    const mute = sonde.muter();
    if (mute.document === document && mute.tables === tables) {
      console.error(`Sonde « ${sonde.nom} » : la mutation n'a rien changé.`);
      echecs += 1;
      continue;
    }
    const constats = verifier(mute.document, mute.tables);
    if (!constats.some((c) => c.includes(sonde.attendu))) {
      console.error(
        `Sonde « ${sonde.nom} » : la porte n'a PAS vu « ${sonde.attendu} ». Elle ne mord plus.`,
      );
      echecs += 1;
      continue;
    }
    console.log(`Sonde « ${sonde.nom} » : la porte mord. ✅`);
  }
  return echecs === 0 ? 0 : 1;
}

function principal() {
  const document = lire(REGISTRE);
  if (process.argv.includes('--autotest')) {
    return autotest(document);
  }
  const constats = verifier(document);
  if (constats.length > 0) {
    console.error(`Export de portabilité — ${constats.length} constat(s) :`);
    for (const constat of constats) {
      console.error(`  - ${constat}`);
    }
    return 1;
  }
  console.log(
    'Export de portabilité : les tables des services sont toutes classées au §6, chaque table exportée est lue par son service, chaque copie nomme une source réellement exportée.',
  );
  return 0;
}

process.exitCode = principal();
