#!/usr/bin/env node
// @ts-check
/**
 * Refuse un document de `docs/` qui n'annonce ni son **statut** ni la **date**
 * à laquelle ce statut a été affirmé.
 *
 * ## Pourquoi ce script existe
 *
 * ISO/IEC/IEEE 26511 traite la documentation comme un produit qui se gère : il
 * lui faut un cycle de revue, donc un état et une date. Sans eux, un lecteur ne
 * peut pas répondre à la seule question qui compte devant un document ancien —
 * « est-ce que ça vaut encore ? ». Un statut sans date ne répond pas davantage :
 * « À valider » de quand ?
 *
 * La règle ne juge PAS la valeur du statut. Elle exige qu'il soit là, et daté.
 * C'est délibéré : une machine peut constater l'absence d'un état, elle ne peut
 * pas savoir qu'une spécification marquée « À valider » décrit en réalité du
 * code parti en production. Cette question-là revient au propriétaire du
 * produit, et la doc 34 §4 la lui pose nommément.
 *
 * ## Les trois formes acceptées
 *
 * Elles ont été RELEVÉES dans le dépôt, pas décrétées : imposer une quatrième
 * forme aurait demandé de reformater une quarantaine de documents pour un gain
 * nul. Sur 48 documents, 32 en portaient déjà une.
 *
 *  1. Bandeau — `> Statut : **Établi** · 2026-08-08`
 *  2. Liste d'en-tête (ADR) — `- **Statut** : Accepté` + `- **Date** : …`
 *  3. Tableau d'en-tête — une ligne `| **Statut** | … |` et une ligne `| **Date** | … |`
 *
 * ## Usage
 *   pnpm statuts             # ou : node scripts/verifier-statut-doc.mjs
 *
 * ## Contraintes de conception
 *  - Aucune conclusion « par défaut » : un balayage qui ne lit aucun document
 *    ÉCHOUE au lieu de rendre « rien à signaler ».
 *  - Lectures `fs` en `try/catch` seul, jamais un `existsSync()` suivi d'un
 *    `readFileSync()` : fenêtre TOCTOU refusée par la règle CodeQL
 *    `js/file-system-race` (HIGH, bloquante en CI).
 */

import fs from 'node:fs';
import path from 'node:path';

const RACINE = path.resolve(import.meta.dirname, '..');

/** Nombre de lignes de tête où le statut doit se trouver (il doit se voir sans défiler). */
const LIGNES_DE_TETE = 18;

/**
 * Documents sans cycle de vie propre. Une entrée qui ne correspond plus à aucun
 * fichier est signalée — l'allowlist ne pourrit pas.
 *
 * @type {{ fichier: string, raison: string }[]}
 */
const SANS_STATUT = [
  {
    fichier: 'docs/README.md',
    raison:
      'index de navigation : il n’a pas d’état propre, il reflète celui des documents qu’il liste.',
  },
  {
    fichier: 'docs/README-nx-template.md',
    raison:
      'gabarit livré par Nx, conservé tel quel : lui donner un statut reviendrait à s’en approprier le contenu.',
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

/** Lit un fichier texte, ou rend `null` s'il est absent/illisible. */
function lireTexte(relatif) {
  try {
    return fs.readFileSync(path.join(RACINE, relatif), 'utf8');
  } catch {
    return null;
  }
}

/**
 * Liste récursivement les `.md` d'un répertoire.
 *
 * @param {string} relatif
 * @returns {string[]}
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

/** Le marqueur de statut, dans l'une des trois formes relevées. */
const MOTIF_STATUT =
  /(?:^|\n)\s*(?:>\s*|-\s*|\|\s*)\*{0,2}Statut\*{0,2}\s*(?::|\|)/i;

/** Une date ISO, seule forme de date acceptée (les conventions du dépôt l'imposent partout). */
const MOTIF_DATE = /\b20\d{2}-\d{2}-\d{2}\b/;

function main() {
  const documents = listerMarkdown('docs');
  const exemptes = new Map(SANS_STATUT.map((e) => [e.fichier, e.raison]));
  const exemptesVues = new Set();

  console.log('Statut daté des documents');

  if (documents.length === 0) {
    erreur(
      'balayage',
      'aucun document markdown lu sous `docs/` — le script est-il lancé depuis le dépôt ?',
    );
    return conclure(0);
  }

  let verifies = 0;
  for (const document of documents) {
    if (exemptes.has(document)) {
      exemptesVues.add(document);
      continue;
    }
    const contenu = lireTexte(document);
    if (contenu === null) continue;
    verifies += 1;
    const tete = contenu.split('\n').slice(0, LIGNES_DE_TETE).join('\n');

    const aStatut = MOTIF_STATUT.test(tete);
    const aDate = MOTIF_DATE.test(tete);

    if (!aStatut && !aDate) {
      erreur(
        document,
        `ni statut ni date dans les ${LIGNES_DE_TETE} premières lignes.`,
        'ajouter un bandeau `> Statut : **<état>** · <AAAA-MM-JJ>` sous le titre (cf. doc 34 §4).',
      );
    } else if (!aStatut) {
      erreur(
        document,
        `une date est présente, mais aucun statut : rien ne dit ce que le document EST aujourd’hui.`,
        'ajouter le statut à côté de la date (cf. doc 34 §4).',
      );
    } else if (!aDate) {
      erreur(
        document,
        `un statut est présent, mais sans date : « ${(MOTIF_STATUT.exec(tete) ?? [''])[0].trim()} » de quand ?`,
        'dater le statut (`· <AAAA-MM-JJ>`) : un état sans date ne se relit pas.',
      );
    }
  }

  for (const { fichier, raison } of SANS_STATUT) {
    if (!exemptesVues.has(fichier)) {
      avertissements.push({
        portee: 'registre',
        message: `exemption inutilisée : \`${fichier}\` (${raison})`,
        remede: 'le fichier a disparu ou a été renommé — retirer l’entrée.',
      });
    }
  }

  return conclure(verifies);
}

/** @param {number} verifies */
function conclure(verifies) {
  console.log(
    `  ${verifies} documents vérifiés, ${SANS_STATUT.length} exemptions déclarées.\n`,
  );
  for (const c of erreurs) {
    console.log(`  ERREUR [${c.portee}] ${c.message}`);
    if (c.remede !== undefined) console.log(`    → ${c.remede}`);
  }
  for (const c of avertissements) {
    console.log(`  AVERTISSEMENT [${c.portee}] ${c.message}`);
    if (c.remede !== undefined) console.log(`    → ${c.remede}`);
  }
  console.log(
    `\n  ${erreurs.length} erreur(s), ${avertissements.length} avertissement(s).`,
  );
  process.exitCode = erreurs.length > 0 ? 1 : 0;
}

main();
