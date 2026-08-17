#!/usr/bin/env node
// @ts-check
/**
 * Relevé des rebuts de consommation (`dead_letter`) sur une pile debout — la
 * preuve littérale exigée par `AM-53` :
 *
 *   select raison, sujet, count(*) from dead_letter group by 1, 2
 *
 * ## Pourquoi ce script existe
 *
 * `pnpm abonnements` juge des **listes** : que chaque durable soit borné à ce que
 * sa projection traite. Il ne peut rien dire de l'effet — un filtre ne s'applique
 * qu'après `consumers.add`/`update` au démarrage du service, sur un durable qui,
 * en production, existe déjà sans filtre. Ce relevé juge donc l'autre bout de la
 * chaîne : après un **cycle de vie complet de foyer** (création, parents, enfants,
 * contrats, planning, effacement — ce que joue `e2e-stack`), les quatre tables
 * `dead_letter` doivent être **vides de `TYPE_INCONNU`**.
 *
 * Avant `AM-53`, ce même relevé montrait, pour chaque `foyer.ParentAjoute.v1`, une
 * ligne chez `svc-planification` **et** une chez `svc-tarification` — payload en
 * clair, adresse e-mail comprise ; et deux lignes de plus par `FoyerMisAJour.v3`,
 * revenus compris.
 *
 * ## Ce que la porte garantit
 *
 *  - Aucun `TYPE_INCONNU` : un événement non traité n'est plus livré, donc n'écrit
 *    plus son payload.
 *  - Aucun `PARSE_KO` ni `ENVELOPPE_INVALIDE` : ce sont des défauts déterministes
 *    (encodage, enveloppe), jamais un effet de charge.
 *
 * ## Ce que la porte NE garantit pas
 *
 *  - `MAX_LIVRAISONS` est **relevé mais non bloquant** : il peut naître d'une
 *    lenteur (dix livraisons espacées de secondes), et un rouge de charge ferait
 *    perdre confiance dans les deux constats ci-dessus. Il est imprimé en évidence.
 *  - Elle ne dit rien de la production : les durables y préexistent, et seul le
 *    redémarrage d'un service y pose le filtre (`LE-53` : un durcissement se
 *    vérifie par un redémarrage).
 *  - Elle ne juge pas l'`outbox` (`AM-61`) — c'est la jauge d'âge qui s'en charge,
 *    en continu et non au passage d'un test.
 *
 * ## Usage
 *   node scripts/relever-rebuts.mjs           # relève et juge (exit 1 si constat)
 *   node scripts/relever-rebuts.mjs --sonde   # prouve que le relevé VOIT une ligne
 *
 * Dépend d'une pile `docker compose` debout (les bases ne sont pas publiées hors
 * loopback, `AM-94`) : appelé par `scripts/e2e-stack.mjs`, jamais par le job `ci`.
 */

import { execFile } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { promisify } from 'node:util';

const execFileP = promisify(execFile);
const RACINE = path.resolve(import.meta.dirname, '..');

/** Raisons bloquantes : des défauts, jamais un effet de charge. */
const RAISONS_BLOQUANTES = ['TYPE_INCONNU', 'PARSE_KO', 'ENVELOPPE_INVALIDE'];

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
 * Contextes à relever : **dérivés** des schémas Drizzle qui déclarent la table, et
 * non listés à la main — `svc-referentiel` n'a pas de `dead_letter`, et un
 * cinquième service qui en gagnerait une doit entrer dans le relevé sans que
 * personne n'y pense.
 * @returns {{service: string, contexte: string, conteneur: string}[]}
 */
function contextes() {
  const compose = lire('docker-compose.yml');
  const apps = fs
    .readdirSync(path.join(RACINE, 'apps'), { withFileTypes: true })
    .filter((e) => e.isDirectory())
    .map((e) => e.name)
    .sort();
  const trouves = [];
  for (const service of apps) {
    let schema;
    try {
      schema = lire(`apps/${service}/src/database/schema.ts`);
    } catch {
      continue; // pas de base (web, api-gateway)
    }
    // Espaces aplatis : la déclaration tient sur deux lignes dans les quatre
    // schémas (`pgTable(\n  'dead_letter',`). Chercher la forme d'une seule ligne
    // ne trouvait rien — et c'est le garde-fou « balayage à vide » ci-dessous qui
    // l'a dit, pas un relevé vide passé pour un succès.
    if (!schema.replace(/\s+/g, ' ').includes("pgTable( 'dead_letter'")) {
      continue;
    }
    const contexte = service.replace(/^svc-/, '');
    const conteneur = `postgres-${contexte}`;
    if (!compose.includes(`  ${conteneur}:`)) {
      throw new Error(
        `apps/${service} déclare \`dead_letter\` mais docker-compose.yml n'a pas de service \`${conteneur}\``,
      );
    }
    trouves.push({ service, contexte, conteneur });
  }
  if (trouves.length === 0) {
    throw new Error(
      'aucun service ne déclare `dead_letter` — balayage à vide, pas un succès',
    );
  }
  return trouves;
}

/**
 * Joue une requête SQL dans le conteneur d'un contexte et rend les lignes brutes.
 * @param {string} conteneur
 * @param {string} contexte
 * @param {string} sql
 */
async function psql(conteneur, contexte, sql) {
  // **Sans shell**, à dessein : la requête porte des espaces et le séparateur de
  // `psql` est un `|`, que `cmd.exe` relirait comme un tube. `-tA` suffit — en mode
  // non aligné, `|` est déjà le séparateur par défaut, il n'y a rien à passer.
  const { stdout } = await execFileP(
    'docker',
    [
      'compose',
      'exec',
      '-T',
      conteneur,
      'psql',
      '-U',
      contexte,
      '-d',
      contexte,
      '-tA',
      '-c',
      sql,
    ],
    { cwd: RACINE },
  );
  return stdout
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l.length > 0);
}

/**
 * Le relevé du critère de sortie, par contexte.
 * @returns {Promise<{contexte: string, lignes: {raison: string, sujet: string, n: number}[]}[]>}
 */
async function relever() {
  const releves = [];
  for (const { contexte, conteneur } of contextes()) {
    const brut = await psql(
      conteneur,
      contexte,
      'select raison, sujet, count(*) from dead_letter group by 1, 2 order by 1, 2',
    );
    releves.push({
      contexte,
      lignes: brut.map((ligne) => {
        const [raison, sujet, n] = ligne.split('|');
        return {
          raison: raison ?? '?',
          sujet: sujet ?? '?',
          n: Number(n ?? '0'),
        };
      }),
    });
  }
  return releves;
}

/** @param {Awaited<ReturnType<typeof relever>>} releves */
function juger(releves) {
  const constats = [];
  for (const { contexte, lignes } of releves) {
    if (lignes.length === 0) {
      console.log(`  ${contexte} : aucun rebut.`);
      continue;
    }
    for (const { raison, sujet, n } of lignes) {
      const bloquant = RAISONS_BLOQUANTES.includes(raison);
      console.log(
        `  ${contexte} : ${raison} ${sujet} ×${n}${bloquant ? '' : '  (relevé, non bloquant)'}`,
      );
      if (bloquant) {
        constats.push(
          `${contexte} : ${n} rebut(s) ${raison} sur ${sujet} — un événement non traité ne doit plus être livré (AM-53)`,
        );
      }
    }
  }
  return constats;
}

/**
 * Sonde négative : sans elle, « aucun rebut » est indiscernable d'un relevé qui
 * regarde la mauvaise table, la mauvaise base, ou dont l'analyse de sortie est
 * cassée. On insère une ligne `TYPE_INCONNU`, on exige que le relevé la voie et
 * la juge bloquante, puis on la retire.
 */
async function sonde() {
  const cible = contextes()[0];
  if (cible === undefined) {
    console.error('Sonde impossible : aucun contexte.');
    return 1;
  }
  const SUJET = 'sonde.TypeQuiNexistePas.v1';
  await psql(
    cible.conteneur,
    cible.contexte,
    `insert into dead_letter (stream, sujet, raison, payload) values ('SONDE', '${SUJET}', 'TYPE_INCONNU', 'sonde')`,
  );
  try {
    const constats = juger(await relever());
    const vue = constats.some((c) => c.includes(SUJET));
    if (!vue) {
      console.error(
        `Sonde négative : le relevé n'a PAS vu la ligne injectée dans ${cible.contexte}. Il ne mord plus.`,
      );
      return 1;
    }
    console.log(
      `Sonde négative : le relevé voit bien un rebut injecté (${cible.contexte}/${SUJET}). ✅`,
    );
    return 0;
  } finally {
    await psql(
      cible.conteneur,
      cible.contexte,
      `delete from dead_letter where sujet = '${SUJET}'`,
    );
  }
}

async function principal() {
  if (process.argv.includes('--sonde')) {
    return sonde();
  }
  console.log('Relevé des rebuts de consommation (dead_letter) :');
  const constats = juger(await relever());
  if (constats.length > 0) {
    console.error(`\nRebuts de consommation — ${constats.length} constat(s) :`);
    for (const constat of constats) {
      console.error(`  - ${constat}`);
    }
    return 1;
  }
  console.log(
    "\nRebuts de consommation : aucun événement non traité n'a laissé de payload (AM-53).",
  );
  return 0;
}

process.exitCode = await principal();
