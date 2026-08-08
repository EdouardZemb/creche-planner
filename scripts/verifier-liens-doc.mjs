#!/usr/bin/env node
// @ts-check
/**
 * Refuse un lien interne mort dans la documentation : cible inexistante, ou
 * ancre qui ne correspond à aucun titre du document visé.
 *
 * ## Pourquoi ce script existe
 *
 * La documentation de ce dépôt est un graphe, pas une pile de fichiers : les
 * renvois croisés (« doc 24 », « cf. §17 ») sont le seul moyen de s'y déplacer,
 * et l'index `docs/README.md` en est la table de matières. Un lien mort n'y est
 * pas un détail de présentation — c'est un chemin de navigation qui disparaît,
 * et personne ne le voit tant qu'il n'est pas suivi.
 *
 * Trois mouvements les fabriquent, tous banals : renommer un fichier, renommer
 * un titre (l'ancre suit le titre), déplacer un document vers
 * `docs/exploitation/`. Aucun n'échoue nulle part aujourd'hui.
 *
 * ## Ce que le script vérifie
 *
 *  - **Cible de fichier** : tout lien relatif pointe un fichier ou un
 *    répertoire qui existe (résolu depuis le répertoire du document source).
 *  - **Ancre** : `#ancre` — seule ou suffixant un chemin — correspond à un titre
 *    du document visé, avec la règle de fabrication de GitHub (minuscules,
 *    ponctuation retirée, espaces en tirets, doublons suffixés `-1`, `-2`…).
 *
 * ## Ce que le script NE vérifie PAS
 *
 * Les URL externes (`http(s)://`). Les joindre demanderait le réseau, et une
 * porte de CI qui dépend d'un site tiers échoue pour des raisons qui ne sont pas
 * celles du dépôt. Le coût de cette limite est assumé : un lien externe mort
 * survit ici.
 *
 * ## Usage
 *   pnpm liens               # ou : node scripts/verifier-liens-doc.mjs
 *
 * ## Contraintes de conception
 *  - Aucune conclusion « par défaut » : un balayage qui ne lit aucun document,
 *    ou qui n'extrait aucun lien, ÉCHOUE au lieu de rendre « rien à signaler ».
 *    Un balayage à vide est indiscernable d'un succès — c'est exactement ce qui
 *    a failli faire conclure « 0 violation » à la session qui a écrit ce script,
 *    alors que le binaire mesuré n'était plus installé.
 *  - Lectures `fs` en `try/catch` seul, jamais un `existsSync()` suivi d'un
 *    `readFileSync()` : ce couple est la fenêtre TOCTOU que la règle CodeQL
 *    `js/file-system-race` (HIGH, bloquante en CI) refuse.
 */

import fs from 'node:fs';
import path from 'node:path';

const RACINE = path.resolve(import.meta.dirname, '..');

/**
 * Répertoires balayés. `.claude/memory/` en fait partie — contrairement au
 * registre des pièges, où il est exclu parce qu'il arbitre des CONSIGNES : ici
 * on ne juge rien, on constate qu'un chemin existe. Un renvoi mort dans une
 * fiche de mémoire coûte le même détour qu'ailleurs.
 */
const REPERTOIRES = ['docs', '.claude/plans', '.claude/memory'];

/** Documents de racine, hors `node_modules` et hors fichiers générés. */
const DOCUMENTS_RACINE = [
  'CLAUDE.md',
  'CONTRIBUTING.md',
  'CONVENTIONS.md',
  'README.md',
  'SECURITY.md',
];

/**
 * Cibles dont l'absence est normale : elles ne sont pas versionnées (produites
 * par un outil, ou vivant seulement sur le poste principal). Une entrée qui ne
 * correspond plus à aucun lien est signalée — l'allowlist ne pourrit pas.
 *
 * @type {{ cible: string, raison: string }[]}
 */
const CIBLES_ABSENTES_ATTENDUES = [
  {
    cible: 'caddy-root.crt',
    raison:
      'artefact EXPORTÉ du conteneur Caddy au déploiement (`docker compose cp caddy:… ./caddy-root.crt`, doc 24) ' +
      'et lu par `scripts/deploy.mjs` s’il existe : il n’a jamais sa place dans le dépôt.',
  },
  {
    cible:
      'creche-planner-public/libs/nest-commons/src/lib/security/scope-foyer.guard.ts',
    raison:
      'fiche de mémoire qui désigne le clone voisin du poste principal (cf. [[repo-clean-clone-location]]) : ' +
      'le chemin est correct là-bas, et une session distante n’a pas ce répertoire.',
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

/** Le chemin existe-t-il (fichier ou répertoire) ? */
function existe(cheminAbsolu) {
  try {
    fs.statSync(cheminAbsolu);
    return true;
  } catch {
    return false;
  }
}

/**
 * Fabrique l'ancre GitHub d'un titre : minuscules, formatage markdown retiré,
 * ponctuation supprimée, espaces en tirets. Les lettres accentuées sont
 * CONSERVÉES (« §18 Phase 12 réalisée » → `18-phase-12-réalisée`) — c'est le
 * comportement réel de GitHub, et la moitié des titres de ce dépôt en portent.
 *
 * @param {string} titre texte brut du titre, sans les `#`
 */
function ancreDepuisTitre(titre) {
  return (
    titre
      // formatage inline : `code`, **gras**, _italique_, [texte](lien)
      .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
      .replace(/[`*_~]/g, '')
      .trim()
      .toLowerCase()
      // tout ce qui n'est ni lettre (accents inclus), ni chiffre, ni espace,
      // ni tiret disparaît — y compris les emoji des titres de plan.
      .replace(/[^\p{L}\p{N} -]/gu, '')
      .replace(/ /g, '-')
  );
}

/**
 * Les ancres d'un document, dans l'ordre, avec la déduplication de GitHub :
 * deux titres identiques donnent `titre` puis `titre-1`.
 *
 * @param {string} contenu
 * @returns {Set<string>}
 */
function ancresDuDocument(contenu) {
  const ancres = new Set();
  const vues = new Map();
  let dansBlocDeCode = false;
  for (const ligne of contenu.split('\n')) {
    if (/^\s*```/.test(ligne)) {
      dansBlocDeCode = !dansBlocDeCode;
      continue;
    }
    if (dansBlocDeCode) continue;
    const titre = /^(#{1,6})\s+(.*)$/.exec(ligne);
    if (titre === null) continue;
    const base = ancreDepuisTitre(titre[2] ?? '');
    if (base === '') continue;
    const rang = vues.get(base) ?? 0;
    vues.set(base, rang + 1);
    ancres.add(rang === 0 ? base : `${base}-${rang}`);
    // GitHub ajoute aussi une ancre `user-content-…` ; sans intérêt ici.
  }
  return ancres;
}

/**
 * Extrait les liens markdown `[texte](cible)` d'un document, hors blocs de code
 * (un exemple de commande n'est pas un lien) et hors images.
 *
 * @param {string} contenu
 * @returns {{ cible: string, ligne: number }[]}
 */
function liensDuDocument(contenu) {
  const liens = [];
  const lignes = contenu.split('\n');
  let dansBlocDeCode = false;
  for (let i = 0; i < lignes.length; i += 1) {
    const ligne = lignes[i] ?? '';
    if (/^\s*```/.test(ligne)) {
      dansBlocDeCode = !dansBlocDeCode;
      continue;
    }
    if (dansBlocDeCode) continue;
    // `![alt](img)` est écarté par le `(?<!!)` : une image absente est un autre
    // sujet (aucune n'est versionnée ici).
    const motif = /(?<!!)\[[^\]]*\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g;
    let trouve;
    while ((trouve = motif.exec(ligne)) !== null) {
      const cible = trouve[1];
      if (cible !== undefined) liens.push({ cible, ligne: i + 1 });
    }
  }
  return liens;
}

/** Un lien à ignorer : externe, protocole, ou ancre de plateforme. */
function estExterne(cible) {
  return /^(https?:|mailto:|tel:|ftp:|data:|#L\d)/.test(cible);
}

function main() {
  const documents = [
    ...DOCUMENTS_RACINE,
    ...REPERTOIRES.flatMap((r) => listerMarkdown(r)),
  ];

  console.log('Liens internes de la documentation');

  if (documents.length === 0) {
    erreur(
      'balayage',
      'aucun document markdown lu — le script est-il lancé depuis le dépôt ?',
      'vérifier `REPERTOIRES` et `DOCUMENTS_RACINE`.',
    );
    return conclure(0, 0);
  }

  /** Cache des ancres par fichier : un document est visé par beaucoup de liens. */
  const ancresParFichier = new Map();
  /** @param {string} relatif */
  const ancresDe = (relatif) => {
    const connu = ancresParFichier.get(relatif);
    if (connu !== undefined) return connu;
    const contenu = lireTexte(path.join(RACINE, relatif));
    const ancres = contenu === null ? null : ancresDuDocument(contenu);
    ancresParFichier.set(relatif, ancres);
    return ancres;
  };

  const ciblesAbsentesAttendues = new Set(
    CIBLES_ABSENTES_ATTENDUES.map((c) => c.cible),
  );
  const exceptionsUtilisees = new Set();
  let liensVerifies = 0;

  for (const document of documents) {
    const contenu = lireTexte(path.join(RACINE, document));
    if (contenu === null) continue;
    const repertoire = path.dirname(document);

    for (const { cible, ligne } of liensDuDocument(contenu)) {
      if (estExterne(cible)) continue;
      liensVerifies += 1;
      const portee = `${document}:${ligne}`;

      const [chemin = '', ancre] = cible.split('#');

      // Lien purement interne au document (`#section`).
      if (chemin === '') {
        if (ancre === undefined || ancre === '') continue;
        const ancres = ancresDuDocument(contenu);
        if (!ancres.has(decodeURIComponent(ancre))) {
          erreur(
            portee,
            `ancre interne inconnue : \`#${ancre}\``,
            'le titre visé a-t-il été renommé ? l’ancre suit le texte du titre.',
          );
        }
        continue;
      }

      const relatif = path
        .normalize(path.join(repertoire, decodeURIComponent(chemin)))
        .replace(/\\/g, '/');

      if (ciblesAbsentesAttendues.has(relatif)) {
        exceptionsUtilisees.add(relatif);
        continue;
      }

      if (!existe(path.join(RACINE, relatif))) {
        erreur(
          portee,
          `cible inexistante : \`${cible}\` → \`${relatif}\``,
          'fichier renommé ou déplacé (les docs d’exploitation vivent dans `docs/exploitation/`).',
        );
        continue;
      }

      if (ancre === undefined || ancre === '') continue;
      if (!relatif.endsWith('.md')) continue;

      const ancres = ancresDe(relatif);
      if (ancres === null) continue;
      if (!ancres.has(decodeURIComponent(ancre))) {
        erreur(
          portee,
          `ancre inconnue dans \`${relatif}\` : \`#${ancre}\``,
          'le titre visé a-t-il été renommé ? l’ancre suit le texte du titre.',
        );
      }
    }
  }

  for (const { cible, raison } of CIBLES_ABSENTES_ATTENDUES) {
    if (!exceptionsUtilisees.has(cible)) {
      avertissements.push({
        portee: 'registre',
        message: `exception inutilisée : \`${cible}\` (${raison})`,
        remede: 'plus aucun lien ne la vise — retirer l’entrée.',
      });
    }
  }

  if (liensVerifies === 0) {
    erreur(
      'balayage',
      `${documents.length} documents lus, mais AUCUN lien interne extrait — l’extraction est cassée.`,
      'vérifier le motif de `liensDuDocument()`.',
    );
  }

  return conclure(documents.length, liensVerifies);
}

/** @param {number} documents @param {number} liens */
function conclure(documents, liens) {
  console.log(
    `  ${documents} documents balayés, ${liens} liens internes vérifiés.\n`,
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
