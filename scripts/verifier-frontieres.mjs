#!/usr/bin/env node
// @ts-check
/**
 * Vérifie les deux invariants de frontière du monorepo (lot D4 du chantier
 * « Consolidation UI & qualité »).
 *
 * ## Pourquoi ce script existe
 *
 * 1. **Les tags Nx ne sont pas « permissifs par défaut », ils sont HORS RÈGLE.**
 *    `@nx/enforce-module-boundaries` n'applique une contrainte qu'aux tags cités
 *    en `sourceTag` dans `depConstraints`. Un contexte que l'on oublie d'y
 *    enregistrer n'est donc pas « autorisé à tout » de façon visible : il est
 *    simplement **jamais évalué**, et le lint reste vert quoi qu'il importe.
 *    C'est une dérive strictement silencieuse — celle qui a laissé
 *    `context:notifications` sans aucune contrainte de contexte pendant toute la
 *    vie du service (défaut trouvé par ce script à son premier run).
 *
 * 2. **Un miroir de vocabulaire ne diverge jamais bruyamment.** Les libs
 *    `type:domain` ne peuvent pas dépendre de `type:contracts` : le vocabulaire
 *    partagé (les modes de garde) y est donc recopié À DESSEIN
 *    (`referentiel-domain/mode-garde.ts`, cf. CONVENTIONS.md §4 « miroir local
 *    documenté »). Un commentaire « tenir identique par convention » ne tient
 *    rien : seule une vérification mécanique le fait. Les copies déclarées
 *    ci-dessous sont comparées à leur source de vérité à chaque CI.
 *
 * ## Usage
 *   pnpm frontieres           # ou : node scripts/verifier-frontieres.mjs
 *
 * ## Contraintes de conception
 *  - Aucune conclusion « par défaut » : si une source est introuvable ou
 *    illisible, le script ÉCHOUE au lieu de rendre « rien à signaler » (un
 *    balayage à vide est indiscernable d'un succès — piège vécu au lot C1).
 *  - Lectures `fs` uniquement, jamais un `existsSync()` suivi d'un
 *    `readFileSync()` : ce couple est une fenêtre TOCTOU que la règle CodeQL
 *    `js/file-system-race` (HIGH, bloquante en CI) refuse.
 */

import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const RACINE = path.resolve(import.meta.dirname, '..');

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

/** Lit un JSON, ou rend `null` s'il est absent/illisible. */
function lireJson(chemin) {
  const brut = lireTexte(chemin);
  if (brut === null) return null;
  try {
    return JSON.parse(brut);
  } catch {
    return null;
  }
}

/** Liste les sous-dossiers d'un dossier (jamais d'exception : `[]` si illisible). */
function sousDossiers(chemin) {
  try {
    return fs
      .readdirSync(chemin, { withFileTypes: true })
      .filter((e) => e.isDirectory() && e.name !== 'node_modules')
      .map((e) => e.name);
  } catch {
    return [];
  }
}

// ---------------------------------------------------------------------------
// 1. Inventaire des projets et de leurs tags
// ---------------------------------------------------------------------------

/**
 * Motifs de projets, lus dans `pnpm-workspace.yaml` plutôt que codés en dur :
 * ajouter `tools/*` au workspace sans le dire à ce script rendrait ses nouveaux
 * projets invisibles — exactement le trou que le script est censé fermer.
 * Seul `*` est géré (les motifs du dépôt n'utilisent rien d'autre) ; tout autre
 * caractère spécial fait échouer le script au lieu d'être ignoré.
 */
function motifsDuWorkspace() {
  const brut = lireTexte(path.join(RACINE, 'pnpm-workspace.yaml'));
  if (brut === null) {
    erreur(
      'workspace',
      '`pnpm-workspace.yaml` illisible : impossible de lister les projets.',
    );
    return [];
  }
  const motifs = [];
  let dansPackages = false;
  for (const ligne of brut.split(/\r?\n/)) {
    if (/^packages:\s*$/.test(ligne)) {
      dansPackages = true;
      continue;
    }
    if (dansPackages) {
      const entree = /^\s+-\s*['"]?([^'"#\s]+)['"]?\s*$/.exec(ligne);
      if (entree?.[1] !== undefined) {
        motifs.push(entree[1]);
        continue;
      }
      if (ligne.trim() !== '') dansPackages = false;
    }
  }
  if (motifs.length === 0) {
    erreur(
      'workspace',
      'aucun motif de paquet trouvé dans `pnpm-workspace.yaml` (section `packages:`).',
    );
  }
  return motifs;
}

/** Développe un motif à segments joker (`apps/*`, `libs/*`, …) en dossiers réels. */
function developper(motif) {
  const segments = motif.split('/');
  let dossiers = [''];
  for (const segment of segments) {
    if (segment === '*') {
      dossiers = dossiers.flatMap((base) =>
        sousDossiers(path.join(RACINE, base)).map((nom) =>
          path.posix.join(base, nom),
        ),
      );
    } else if (segment.includes('*')) {
      erreur(
        'workspace',
        `motif de paquet non géré par ce script : \`${motif}\`.`,
      );
      return [];
    } else {
      dossiers = dossiers.map((base) => path.posix.join(base, segment));
    }
  }
  return dossiers.filter((d) => d !== '');
}

/**
 * @returns {{ nom: string, racine: string, tags: string[] }[]}
 */
function inventorierProjets() {
  const projets = [];
  for (const motif of motifsDuWorkspace()) {
    for (const dossier of developper(motif)) {
      const pkg = lireJson(path.join(RACINE, dossier, 'package.json'));
      if (pkg === null) continue; // dossier intermédiaire (`libs/contracts`), pas un projet
      const projectJson = lireJson(path.join(RACINE, dossier, 'project.json'));
      const tags = projectJson?.tags ?? pkg.nx?.tags ?? [];
      projets.push({
        nom: projectJson?.name ?? pkg.nx?.name ?? pkg.name ?? dossier,
        racine: dossier,
        tags,
      });
    }
  }
  return projets;
}

// ---------------------------------------------------------------------------
// 2. Contraintes déclarées dans la flat config ESLint
// ---------------------------------------------------------------------------

/** @returns {Promise<{ sourceTag: string, onlyDependOnLibsWithTags?: string[], notDependOnLibsWithTags?: string[] }[] | null>} */
async function lireDepConstraints() {
  const chemin = path.join(RACINE, 'eslint.config.mjs');
  let config;
  try {
    config = (await import(pathToFileURL(chemin).href)).default;
  } catch (cause) {
    erreur(
      'eslint.config.mjs',
      `configuration ESLint non importable : ${cause instanceof Error ? cause.message : String(cause)}`,
      'les dépendances sont-elles installées (`corepack pnpm@10.34.2 install`) ?',
    );
    return null;
  }
  for (const bloc of Array.isArray(config) ? config : []) {
    const regle = bloc?.rules?.['@nx/enforce-module-boundaries'];
    const options = Array.isArray(regle) ? regle[1] : undefined;
    if (options?.depConstraints !== undefined) return options.depConstraints;
  }
  erreur(
    'eslint.config.mjs',
    'aucune règle `@nx/enforce-module-boundaries` avec des `depConstraints` trouvée.',
    'la règle a-t-elle été renommée ou déplacée ? sans elle, AUCUNE frontière n’est vérifiée.',
  );
  return null;
}

/**
 * @param {{ nom: string, racine: string, tags: string[] }[]} projets
 * @param {{ sourceTag: string, onlyDependOnLibsWithTags?: string[], notDependOnLibsWithTags?: string[] }[]} contraintes
 */
function verifierTags(projets, contraintes) {
  const tagsPortes = new Set(projets.flatMap((p) => p.tags));
  const tagsContraints = new Set(contraintes.map((c) => c.sourceTag));

  for (const projet of projets) {
    const types = projet.tags.filter((t) => t.startsWith('type:'));
    const contextes = projet.tags.filter((t) => t.startsWith('context:'));
    if (types.length !== 1 || contextes.length !== 1) {
      erreur(
        projet.nom,
        `tags attendus : exactement un \`type:\` et un \`context:\` — trouvés [${projet.tags.join(', ')}].`,
        `déclarer les tags dans \`${projet.racine}/package.json\` (champ \`nx.tags\`).`,
      );
    }
  }

  for (const tag of [...tagsPortes].sort()) {
    if (!tagsContraints.has(tag)) {
      erreur(
        'depConstraints',
        `le tag \`${tag}\` est porté par ${projets
          .filter((p) => p.tags.includes(tag))
          .map((p) => p.nom)
          .join(
            ', ',
          )} mais n’apparaît en \`sourceTag\` dans AUCUNE contrainte : ces projets ne sont soumis à aucune frontière de ce niveau.`,
        `ajouter une entrée \`{ sourceTag: '${tag}', onlyDependOnLibsWithTags: [...] }\` dans \`eslint.config.mjs\`.`,
      );
    }
  }

  for (const contrainte of contraintes) {
    if (!tagsPortes.has(contrainte.sourceTag)) {
      avertir(
        'depConstraints',
        `la contrainte \`${contrainte.sourceTag}\` ne s’applique à aucun projet (règle morte).`,
        'la retirer, ou vérifier que le tag n’a pas été renommé.',
      );
    }
    const cibles = [
      ...(contrainte.onlyDependOnLibsWithTags ?? []),
      ...(contrainte.notDependOnLibsWithTags ?? []),
    ];
    for (const cible of cibles) {
      if (cible !== '*' && !tagsPortes.has(cible)) {
        erreur(
          'depConstraints',
          `la contrainte \`${contrainte.sourceTag}\` autorise/interdit le tag \`${cible}\`, qui n’est porté par aucun projet.`,
          'faute de frappe ? un tag inexistant en `onlyDependOnLibsWithTags` restreint sans le dire.',
        );
      }
    }
  }
}

// ---------------------------------------------------------------------------
// 3. Miroirs de vocabulaire
// ---------------------------------------------------------------------------

/**
 * Registre des recopies ASSUMÉES d'un vocabulaire partagé (convention « miroir
 * local documenté », CONVENTIONS.md §4). **Tout nouveau miroir s'ajoute ici** —
 * c'est le prix de la recopie, et le seul moyen qu'elle ne dérive pas.
 *
 * `relation` :
 *  - `identique`     — même ensemble de valeurs que la source, exactement ;
 *  - `sur-ensemble`  — contient au moins toutes les valeurs de la source.
 */
const MIROIRS = [
  {
    nom: 'modes de garde',
    source: {
      fichier: 'libs/contracts/kernel/src/lib/modes.ts',
      symbole: 'MODES_CONTRAT',
    },
    copies: [
      {
        fichier: 'libs/referentiel/domain/src/lib/mode-garde.ts',
        symbole: 'MODES_GARDE',
        relation: 'identique',
        motif:
          'lib `type:domain` : ne peut pas dépendre d’un lib `type:contracts`.',
      },
      {
        fichier: 'libs/referentiel/domain/src/lib/mode-garde.ts',
        symbole: 'ModeGarde',
        relation: 'identique',
        motif: 'union locale du miroir ci-dessus.',
      },
      {
        fichier: 'libs/tarification/domain/src/lib/core/politique-tarifaire.ts',
        symbole: 'PolitiqueTarifaireId',
        relation: 'sur-ensemble',
        motif:
          'les 4 modes + 2 politiques internes (FRAIS_FIXES_ABCM, UNITES_ASSOCIATIVES) : sur-ensemble VOLONTAIRE, pas un miroir divergent.',
      },
      {
        fichier: 'libs/contracts/kernel/src/lib/openapi/gateway.openapi.ts',
        enumerationsOpenapi: true,
        relation: 'identique',
        motif:
          'document OpenAPI écrit à la main : ses `enum` recopient le vocabulaire au lieu de l’importer.',
      },
    ],
  },
  {
    nom: 'modes ABCM',
    source: {
      fichier: 'libs/contracts/kernel/src/lib/modes.ts',
      symbole: 'MODES_ABCM',
    },
    copies: [
      {
        fichier: 'libs/referentiel/domain/src/lib/mode-garde.ts',
        symbole: 'MODES_ABCM',
        relation: 'identique',
        motif: 'lib `type:domain` : même raison que `MODES_GARDE`.',
      },
    ],
  },
];

/** Extrait les chaînes littérales d'une région de source. */
function litteraux(region) {
  return [...region.matchAll(/'([^'\\]*)'|"([^"\\]*)"/g)].map(
    (m) => m[1] ?? m[2] ?? '',
  );
}

/**
 * Rend les valeurs déclarées par `export const X = [...]` ou
 * `export type X = 'a' | 'b'`, ou `null` si le symbole est introuvable.
 * @returns {string[] | null}
 */
function valeursDeclarees(contenu, symbole) {
  const tableau = new RegExp(`export const ${symbole}\\b[^=]*=\\s*\\[`).exec(
    contenu,
  );
  if (tableau !== null) {
    const debut = tableau.index + tableau[0].length;
    const fin = contenu.indexOf(']', debut);
    if (fin === -1) return null;
    return litteraux(contenu.slice(debut, fin));
  }
  const union = new RegExp(`export type ${symbole}\\b[^=]*=`).exec(contenu);
  if (union !== null) {
    const debut = union.index + union[0].length;
    const fin = contenu.indexOf(';', debut);
    if (fin === -1) return null;
    return litteraux(contenu.slice(debut, fin));
  }
  return null;
}

/** Rend les listes `enum: [...]` du document OpenAPI citant au moins une valeur attendue. */
function enumerationsOpenapi(contenu, attendues) {
  return [...contenu.matchAll(/enum:\s*\[([^\]]*)\]/g)]
    .map((m) => litteraux(m[1] ?? ''))
    .filter((valeurs) => valeurs.some((v) => attendues.includes(v)));
}

/** @param {string[]} a @param {string[]} b */
function memeEnsemble(a, b) {
  const ta = [...new Set(a)].sort();
  const tb = [...new Set(b)].sort();
  return ta.length === tb.length && ta.every((v, i) => v === tb[i]);
}

function verifierMiroirs() {
  for (const groupe of MIROIRS) {
    const portee = `miroir « ${groupe.nom} »`;
    const contenuSource = lireTexte(path.join(RACINE, groupe.source.fichier));
    if (contenuSource === null) {
      erreur(
        portee,
        `source de vérité illisible : \`${groupe.source.fichier}\`.`,
      );
      continue;
    }
    const attendues = valeursDeclarees(contenuSource, groupe.source.symbole);
    if (attendues === null || attendues.length === 0) {
      erreur(
        portee,
        `\`${groupe.source.symbole}\` introuvable (ou vide) dans \`${groupe.source.fichier}\`.`,
        'le symbole a-t-il été renommé ? mettre à jour le registre `MIROIRS` de ce script.',
      );
      continue;
    }

    for (const copie of groupe.copies) {
      const contenu = lireTexte(path.join(RACINE, copie.fichier));
      if (contenu === null) {
        erreur(portee, `copie illisible : \`${copie.fichier}\`.`);
        continue;
      }

      if (copie.enumerationsOpenapi === true) {
        const listes = enumerationsOpenapi(contenu, attendues);
        if (listes.length === 0) {
          erreur(
            portee,
            `aucune énumération de \`${groupe.source.symbole}\` trouvée dans \`${copie.fichier}\` : le registre de ce script est périmé.`,
          );
          continue;
        }
        listes.forEach((valeurs, index) => {
          if (!memeEnsemble(valeurs, attendues)) {
            erreur(
              portee,
              `\`${copie.fichier}\` — énumération OpenAPI n°${index + 1} : [${valeurs.join(', ')}] ≠ [${attendues.join(', ')}].`,
              copie.motif,
            );
          }
        });
        continue;
      }

      const valeurs = valeursDeclarees(contenu, copie.symbole);
      if (valeurs === null || valeurs.length === 0) {
        erreur(
          portee,
          `\`${copie.symbole}\` introuvable (ou vide) dans \`${copie.fichier}\`.`,
          'renommage ? mettre à jour le registre `MIROIRS` de ce script.',
        );
        continue;
      }
      const conforme =
        copie.relation === 'sur-ensemble'
          ? attendues.every((v) => valeurs.includes(v))
          : memeEnsemble(valeurs, attendues);
      if (!conforme) {
        erreur(
          portee,
          `\`${copie.fichier}\` — \`${copie.symbole}\` (${copie.relation}) : [${valeurs.join(', ')}] vs source [${attendues.join(', ')}].`,
          copie.motif,
        );
      }
    }
  }
}

// ---------------------------------------------------------------------------
// Exécution
// ---------------------------------------------------------------------------

const projets = inventorierProjets();
if (projets.length === 0) {
  erreur(
    'workspace',
    'aucun projet trouvé : le script n’a rien vérifié du tout.',
  );
}
const contraintes = await lireDepConstraints();
if (contraintes !== null && projets.length > 0) {
  verifierTags(projets, contraintes);
}
verifierMiroirs();

console.log('Frontières Nx & miroirs de vocabulaire');
console.log(
  `  ${projets.length} projets inventoriés, ${contraintes?.length ?? 0} contraintes de dépendance, ` +
    `${MIROIRS.reduce((n, g) => n + g.copies.length, 0)} copies de vocabulaire déclarées.`,
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
process.exit(erreurs.length > 0 ? 1 : 0);
