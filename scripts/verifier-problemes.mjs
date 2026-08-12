#!/usr/bin/env node
// @ts-check
/**
 * Porte du format d'erreur unique de la passerelle (RFC 9457, `AM-37`, lot 4 des
 * standards).
 *
 * ## Pourquoi ce script existe
 *
 * Le format vit dans **trois fichiers qui ne peuvent pas s'importer les uns les
 * autres** :
 *
 *  - `libs/contracts/kernel/src/lib/dto/probleme.ts` — le contrat et le registre
 *    des codes métier ;
 *  - `libs/contracts/kernel/src/lib/openapi/gateway.openapi.ts` — le document
 *    publié, qui ne peut **rien** importer (il est lu par le générateur de types
 *    via le type-stripping de Node, qui ne résoudrait pas un import de `.ts`) ;
 *  - les services, qui posent les codes métier en clair dans leurs 409.
 *
 * Trois déclarations séparées d'une même vérité, c'est la définition d'un miroir.
 * Le dépôt en a déjà payé le prix : un code ajouté dans un service et inconnu du
 * registre serait **silencieusement effacé** par le filtre de la passerelle (il
 * ne republie que les codes qu'il connaît), et l'écran retomberait sur un message
 * générique sans que rien ne rougisse.
 *
 * ## Ce que la porte garantit
 *
 * 1. Tout code métier `CODE_EN_MAJUSCULES` émis par un service est **dans le
 *    registre** (attendu dérivé du code source, jamais recopié).
 * 2. L'énumération `code` du document OpenAPI **est** le registre — même
 *    ensemble, ni plus ni moins.
 * 3. Le type de média écrit dans le document est celui que déclare
 *    `MEDIA_TYPE_PROBLEME`.
 * 4. Le document ne peut pas être écrit sans le schéma `Probleme` ni sans la
 *    dérivation qui l'attache aux réponses d'erreur.
 *
 * ## Ce que la porte NE garantit pas
 *
 *  - Elle ne dit rien de ce que la passerelle **émet réellement** : c'est le rôle
 *    de `probleme.filter.spec.ts` (corps observés) et du test E2E API, qui seul
 *    vérifie l'en-tête `Content-Type` sur le fil.
 *  - Elle ne vérifie pas qu'un code métier atteint la passerelle : la capture du
 *    corps d'erreur amont reste **opt-in** par client (`AM-66`), et trois des
 *    cinq clients ne la posent pas.
 *  - Elle n'a pas d'avis sur les libellés (`title`, `detail`) : ils sont écrits
 *    pour être lus, pas pour être comparés.
 *  - Elle ne juge pas l'appariement route par route entre les exemptions du
 *    document et `@FormatErreurNatif()` — c'est
 *    `apps/api-gateway/src/openapi/probleme.couverture.spec.ts`, qui lit la
 *    métadonnée Nest réelle.
 *
 * ## Usage
 *   pnpm problemes              # vérifie (exit 1 si un constat)
 *   pnpm problemes --autotest   # rejoue les sondes négatives
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
const CONTRAT = 'libs/contracts/kernel/src/lib/dto/probleme.ts';
const OPENAPI = 'libs/contracts/kernel/src/lib/openapi/gateway.openapi.ts';

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
 * Tous les fichiers `.ts` de production sous `apps/` (specs et artefacts de
 * build exclus). Parcours explicite plutôt que `glob` : zéro dépendance.
 *
 * @param {string} depuis
 * @returns {string[]}
 */
function sourcesApplicatives(depuis) {
  /** @type {string[]} */
  const trouves = [];
  /** @type {import('node:fs').Dirent[]} */
  let entrees;
  try {
    entrees = fs.readdirSync(depuis, { withFileTypes: true });
  } catch {
    return trouves;
  }
  for (const entree of entrees) {
    const complet = path.join(depuis, entree.name);
    if (entree.isDirectory()) {
      if (
        ['node_modules', 'dist', 'out-tsc', 'test-output'].includes(entree.name)
      )
        continue;
      trouves.push(...sourcesApplicatives(complet));
    } else if (
      entree.name.endsWith('.ts') &&
      !entree.name.includes('.spec.') &&
      !entree.name.includes('.test.') &&
      !entree.name.includes('.fixture.')
    ) {
      trouves.push(complet);
    }
  }
  return trouves;
}

/** Codes du registre (`CODES_PROBLEME`), dérivés du contrat. */
function registre(contrat) {
  const bloc = /export const CODES_PROBLEME = \{([\s\S]*?)\n\} as const;/.exec(
    contrat,
  );
  if (!bloc) return [];
  return [...bloc[1].matchAll(/^\s{2}([A-Z][A-Z0-9_]*):/gm)].map((m) => m[1]);
}

/** Codes métier réellement posés dans les corps d'erreur des applications. */
function codesEmis() {
  /** @type {Map<string, string[]>} */
  const parCode = new Map();
  for (const fichier of sourcesApplicatives(path.join(RACINE, 'apps'))) {
    let source;
    try {
      source = fs.readFileSync(fichier, 'utf8');
    } catch {
      continue;
    }
    for (const trouve of source.matchAll(/\bcode: '([A-Z][A-Z0-9_]{2,})'/g)) {
      const relatif = path.relative(RACINE, fichier).replaceAll('\\', '/');
      parCode.set(trouve[1], [...(parCode.get(trouve[1]) ?? []), relatif]);
    }
  }
  return parCode;
}

/**
 * @param {string} contrat
 * @param {string} openapi
 * @param {Map<string, string[]>} emis
 * @returns {string[]}
 */
function verifier(contrat, openapi, emis) {
  /** @type {string[]} */
  const constats = [];

  const codes = registre(contrat);
  if (codes.length === 0) {
    constats.push(
      `${CONTRAT} : registre \`CODES_PROBLEME\` introuvable ou vide — la porte ne peut rien comparer`,
    );
    return constats;
  }

  // 1. Tout code émis par une application est connu du registre.
  for (const [code, fichiers] of [...emis].sort()) {
    if (!codes.includes(code)) {
      constats.push(
        `code métier \`${code}\` émis par ${fichiers.join(', ')} mais absent de CODES_PROBLEME : le filtre de la passerelle l'effacera en silence`,
      );
    }
  }
  if (emis.size === 0) {
    constats.push(
      "aucun code métier trouvé dans apps/ : le balayage ne mord plus (motif `code: 'XXX'` changé ?)",
    );
  }

  // 2. L'énumération du document OpenAPI EST le registre.
  const enumeration = /code: \{[\s\S]*?enum: \[([\s\S]*?)\],\s*\},/.exec(
    openapi,
  );
  if (!enumeration) {
    constats.push(
      `${OPENAPI} : schéma \`Probleme\` sans énumération \`code\` — le contrat publié ne dit plus quels codes existent`,
    );
  } else {
    const publies = [...enumeration[1].matchAll(/'([A-Z][A-Z0-9_]*)'/g)].map(
      (m) => m[1],
    );
    for (const code of codes) {
      if (!publies.includes(code)) {
        constats.push(
          `code \`${code}\` du registre absent de l'énumération OpenAPI : il circule sans être documenté`,
        );
      }
    }
    for (const code of publies) {
      if (!codes.includes(code)) {
        constats.push(
          `code \`${code}\` documenté dans l'OpenAPI mais absent du registre : le contrat promet ce que la passerelle n'émettra jamais`,
        );
      }
    }
  }

  // 3. Le type de média du document est celui du contrat.
  const media = /export const MEDIA_TYPE_PROBLEME = '([^']+)'/.exec(contrat);
  if (!media) {
    constats.push(`${CONTRAT} : \`MEDIA_TYPE_PROBLEME\` introuvable`);
  } else if (!openapi.includes(`'${media[1]}'`)) {
    constats.push(
      `${OPENAPI} n'écrit nulle part le type de média \`${media[1]}\` déclaré par le contrat`,
    );
  }

  // 4. Le document porte le schéma et la dérivation qui l'attache.
  if (!/^\s{6}Probleme: \{/m.test(openapi)) {
    constats.push(
      `${OPENAPI} : schéma \`Probleme\` absent de components.schemas — les réponses d'erreur ne référencent plus rien`,
    );
  }
  if (!openapi.includes("$ref: '#/components/schemas/Probleme'")) {
    constats.push(
      `${OPENAPI} : aucune référence à \`#/components/schemas/Probleme\` — la dérivation \`avecProblemes\` a disparu`,
    );
  }

  return constats;
}

/**
 * Sondes négatives. Aucune ne vise un littéral : chacune **dérive** sa mutation
 * du fichier réel, parce que trois sondes de ce dépôt écrites sur un littéral
 * ont cessé de mordre en silence (`LE-22`, `LE-33`).
 *
 * @param {string} contrat
 * @param {string} openapi
 * @param {Map<string, string[]>} emis
 */
function autotest(contrat, openapi, emis) {
  const codes = registre(contrat);
  if (codes.length === 0) {
    console.error('Sonde impossible : registre vide.');
    return 1;
  }
  const premier = codes[0];

  /** @type {{ nom: string, constats: string[], attendu: string }[]} */
  const sondes = [];

  // (a) un service émet un code que le registre ignore.
  sondes.push({
    nom: 'code émis hors registre',
    constats: verifier(
      contrat,
      openapi,
      new Map([...emis, ['CODE_JAMAIS_ENREGISTRE', ['apps/sonde/faux.ts']]]),
    ),
    attendu: 'CODE_JAMAIS_ENREGISTRE',
  });

  // (b) le registre gagne un code que l'OpenAPI ne publie pas.
  sondes.push({
    nom: 'registre en avance sur le contrat publié',
    constats: verifier(
      contrat.replace(
        `  ${premier}:`,
        `  CODE_NON_PUBLIE: 'sonde',\n  ${premier}:`,
      ),
      openapi,
      emis,
    ),
    attendu: 'CODE_NON_PUBLIE',
  });

  // (c) le type de média du document s'écarte du contrat.
  sondes.push({
    nom: 'type de média divergent',
    constats: verifier(
      contrat,
      openapi.replaceAll('application/problem+json', 'application/erreur+json'),
      emis,
    ),
    attendu: 'type de média',
  });

  // (d) la dérivation qui attache le schéma disparaît.
  sondes.push({
    nom: 'dérivation retirée',
    constats: verifier(
      contrat,
      openapi.replaceAll("$ref: '#/components/schemas/Probleme'", "$ref: ''"),
      emis,
    ),
    attendu: 'avecProblemes',
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
  const contrat = lire(CONTRAT);
  const openapi = lire(OPENAPI);
  const emis = codesEmis();

  if (process.argv.includes('--autotest')) {
    return autotest(contrat, openapi, emis);
  }
  const constats = verifier(contrat, openapi, emis);
  if (constats.length > 0) {
    console.error(`Format d'erreur RFC 9457 — ${constats.length} constat(s) :`);
    for (const constat of constats) {
      console.error(`  - ${constat}`);
    }
    return 1;
  }
  console.log(
    `Format d'erreur RFC 9457 : ${registre(contrat).length} code(s) métier, tous émis depuis le registre, publiés à l'identique dans l'OpenAPI.`,
  );
  return 0;
}

process.exitCode = principal();
