#!/usr/bin/env node
// @ts-check
/**
 * Refuse qu'un paquet dont l'IDENTITÉ doit être unique se résolve en plusieurs
 * versions dans `pnpm-lock.yaml`.
 *
 * ## Pourquoi ce script existe
 *
 * Le 2026-10-02, un lockfile régénéré a fait entrer un SECOND `@nestjs/common`
 * dans l'arbre. Aucune ligne de code n'avait changé, aucune porte n'a bronché,
 * et la passerelle a cessé de compiler : deux copies d'un même paquet sont deux
 * `class` distinctes pour TypeScript et deux jeux de jetons distincts pour
 * l'injection de dépendances de NestJS. Le défaut a coûté une heure de
 * recherche parce qu'il ne ressemble à rien — le diff ne montre qu'un lockfile.
 *
 * C'est la forme habituelle des incidents de ce dépôt : une affirmation vraie
 * quand elle a été écrite (« il n'y a qu'un `@nestjs/common` »), fausse quand
 * elle a été lue. Elle n'était écrite nulle part, donc personne ne la relisait.
 * Ce script l'écrit, et la confronte au lockfile à chaque PR.
 *
 * ## Pourquoi PAS `pnpm dedupe --check`
 *
 * C'était le candidat naturel ; il a été écarté pour deux raisons, détaillées
 * dans [ADR-0011](../docs/adr/0011-porte-anti-doublon-de-dependances.md) :
 *  - il répond à une AUTRE question — « les plages déclarées permettraient-elles
 *    de resserrer le lockfile ? » — et non « ce paquet-ci a-t-il deux
 *    identités ? » ;
 *  - il RÉSOUT contre le registre npm. Son verdict dépend donc de ce que le
 *    registre contient à l'instant du run : le même commit peut passer
 *    aujourd'hui et échouer demain. Ce serait fabriquer un exemplaire de plus
 *    du défaut qu'on cherche à tuer.
 *
 * ## Pourquoi une LISTE et pas « zéro doublon »
 *
 * Mesuré sur `main` à `5e9b8b9` : **193 paquets** portent plusieurs versions,
 * pour **263 instances excédentaires**. Un monorepo en a légitimement — trois
 * `@esbuild/*`, cinq `minimatch`, quatre `react-is`. Une porte qui crierait sur
 * ces 193-là serait désactivée en deux semaines, et c'est le vrai risque ici,
 * pas le faux négatif. La porte ne juge donc que les paquets dont la
 * DUPLICATION CASSE QUELQUE CHOSE, nommés un par un avec leur raison.
 *
 * ## Ce que la porte NE peut pas savoir
 *
 *  - Elle ne découvre pas les identités sensibles : la liste est écrite à la
 *    main, et un paquet sensible qu'on oublie d'y mettre n'est pas gardé. C'est
 *    le prix du silence (cf. ADR-0011 §Conséquences).
 *  - Elle lit le LOCKFILE, pas `node_modules` : une résolution locale abîmée
 *    (install partiel, `pnpm store` corrompu) lui est invisible.
 *  - Elle ignore les suffixes de pairs (`(react@19.2.8)`) : deux entrées de
 *    `snapshots:` pour une même version ne sont PAS deux identités.
 *
 * ## Usage
 *   pnpm doublons               # ou : node scripts/verifier-doublons.mjs
 *   pnpm doublons --autotest    # rejoue les sondes négatives
 *
 * ## Contraintes de conception
 *  - Aucune conclusion « par défaut » : lockfile illisible, section `packages:`
 *    vide, ou liste dont AUCUNE entrée ne retrouve son paquet ⇒ ÉCHEC. Un
 *    balayage à vide est indiscernable d'un dépôt sain.
 *  - Aucun réseau, aucun `node_modules`, moins d'une seconde.
 *  - Lectures `fs` en `try/catch` seul (règle CodeQL `js/file-system-race`).
 */

import fs from 'node:fs';
import path from 'node:path';

const RACINE = path.resolve(import.meta.dirname, '..');
const LOCKFILE = 'pnpm-lock.yaml';

/**
 * Les paquets dont deux copies ne cohabitent pas. Chaque entrée dit CE QUI
 * CASSE — sans quoi la liste devient un dogme qu'on n'ose plus réduire.
 *
 * @type {{ paquet: string, raison: string }[]}
 */
const IDENTITES_UNIQUES = [
  {
    paquet: '@nestjs/common',
    raison:
      'décorateurs et jetons d’injection : deux copies = deux identités de `Injectable`, et la passerelle ne compile plus (défaut du 2026-10-02, PR #408).',
  },
  {
    paquet: '@nestjs/core',
    raison:
      'conteneur d’injection : deux copies = deux graphes de modules, et un provider résolu dans l’un est introuvable depuis l’autre.',
  },
  {
    paquet: '@nestjs/config',
    raison:
      'le `ConfigModule` est global : deux copies = deux registres de configuration, dont un vide.',
  },
  {
    paquet: '@nestjs/platform-express',
    raison:
      'adaptateur HTTP : doit partager exactement le `@nestjs/core` de l’application.',
  },
  {
    paquet: '@nestjs/terminus',
    raison:
      'les indicateurs de santé s’enregistrent par jeton dans le conteneur : même raison que `@nestjs/core`.',
  },
  {
    paquet: 'reflect-metadata',
    raison:
      'polyfill GLOBAL (`Reflect.defineMetadata`) : la seconde copie écrase la table de métadonnées de la première, et les décorateurs perdent leurs types.',
  },
  {
    paquet: 'rxjs',
    raison:
      '`instanceof Observable` franchit les frontières de modules dans tout NestJS : deux copies et l’opérateur d’un côté ne reconnaît plus le flux de l’autre.',
  },
  {
    paquet: 'react',
    raison:
      'le répartiteur de hooks est un singleton de module : deux copies ⇒ « Invalid hook call » à l’exécution, invisible au build.',
  },
  {
    paquet: 'react-dom',
    raison: 'doit partager exactement le `react` monté : même raison.',
  },
  {
    paquet: 'zod',
    raison:
      'les schémas portent une marque de type et `instanceof ZodError` est testé à la frontière HTTP (RFC 9457) : deux copies = une erreur de validation qui n’est plus reconnue comme telle.',
  },
  {
    paquet: 'drizzle-orm',
    raison:
      'les symboles de table et de colonne identifient le schéma : deux copies = une requête construite avec un schéma que le client ne reconnaît pas.',
  },
  {
    paquet: '@opentelemetry/api',
    raison:
      'enregistrement GLOBAL du fournisseur de traces : la seconde copie voit un fournisseur par défaut muet, et ses spans disparaissent.',
  },
  {
    paquet: 'typescript',
    raison:
      'deux compilateurs pour un même `tsconfig` : le typage que la CI juge n’est pas celui que l’éditeur applique, et l’écart ne se voit qu’au moment où il fait mal.',
  },
];

/**
 * Doublons CONNUS et acceptés pour un temps BORNÉ. Une tolérance sans date est
 * un oubli permanent déguisé en décision : la porte en exige une, et échoue
 * quand elle est passée. C'est la même règle que les exceptions de
 * `.trivyignore` — on ne gagne rien à l'apprendre deux fois.
 *
 * ⚠️ Les deux dates ci-dessous ont été POSÉES par la PR qui crée cette porte,
 * faute de date préexistante. Elles valent proposition, pas décision.
 *
 * @type {{ paquet: string, versions: string[], raison: string, jusquau: string }[]}
 */
const TOLERANCES = [
  {
    paquet: 'rxjs',
    versions: ['7.8.1', '7.8.2'],
    raison:
      'écart de correctif seulement (7.8.1 / 7.8.2), tiré par une dépendance transitive qui épingle 7.8.1. Remède : un override pnpm `rxjs: ^7.8.2`, qui demande une régénération du lockfile — à faire dans sa propre PR, pas dans celle qui pose la porte.',
    jusquau: '2026-11-30',
  },
  {
    paquet: 'typescript',
    versions: ['5.9.3', '6.0.3'],
    raison:
      'le dépôt compile en 5.9 (`package.json` : `~5.9.2`) ; la 6.0.3 est tirée par un outil de la chaîne de portes. Aucun code applicatif n’est compilé par la 6.0. Remède : identifier l’outil et l’épingler, ou assumer la montée en 6.0 dans sa propre PR.',
    jusquau: '2026-12-31',
  },
];

/** @typedef {{ portee: string, message: string, remede?: string }} Constat */

/** @type {Constat[]} */
const erreurs = [];
/** @type {Constat[]} */
const avertissements = [];
/** Ce que la porte a réellement confronté : garde anti-balayage-à-vide. */
const faitsVerifies = new Set();

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

/**
 * Lecteur INJECTABLE : `--autotest` le remplace pour abîmer le lockfile EN
 * MÉMOIRE. Le disque n'est jamais modifié par une sonde.
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

/** Le jour courant, injectable pour que les sondes ne dépendent pas du calendrier. */
let aujourdhui = () => new Date();

/**
 * Les versions de chaque paquet, lues dans la section `packages:` du lockfile.
 *
 * Pourquoi `packages:` et pas `snapshots:` : `packages:` porte les clés
 * CANONIQUES (`nom@version`), une par artefact réellement installé.
 * `snapshots:` répète la même version autant de fois qu'il existe de
 * résolutions de pairs (`nom@version(react@19.2.8)`) — les compter donnerait
 * des « doublons » qui n'en sont pas.
 *
 * Analyse ligne à ligne : la structure visée est plate et connue, et ce script
 * doit tourner AVANT `pnpm install`, donc sans dépendance YAML.
 *
 * @param {string} contenu
 * @returns {Map<string, Set<string>>} nom du paquet → versions
 */
function versionsParPaquet(contenu) {
  /** @type {Map<string, Set<string>>} */
  const parNom = new Map();
  let section = null;
  for (const ligne of contenu.split('\n')) {
    const entete = /^([a-zA-Z]+):\s*$/.exec(ligne);
    if (entete !== null) {
      section = entete[1];
      continue;
    }
    if (section !== 'packages') continue;
    const cle = /^ {2}('?)(\S.*?)\1:\s*$/.exec(ligne);
    if (cle === null || cle[2] === undefined) continue;
    const brut = cle[2];
    const coupure = brut.lastIndexOf('@');
    if (coupure <= 0) continue;
    const nom = brut.slice(0, coupure);
    const version = brut.slice(coupure + 1);
    if (!/^\d/.test(version)) continue;
    const connues = parNom.get(nom);
    if (connues === undefined) parNom.set(nom, new Set([version]));
    else connues.add(version);
  }
  return parNom;
}

/** Une date `YYYY-MM-DD` valide, ou `null`. */
function jourValide(texte) {
  if (typeof texte !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(texte)) {
    return null;
  }
  const date = new Date(`${texte}T00:00:00Z`);
  return Number.isNaN(date.getTime()) ? null : date;
}

/** Remet la porte à zéro entre deux passes (l'autotest en enchaîne plusieurs). */
function reinitialiser() {
  erreurs.length = 0;
  avertissements.length = 0;
  faitsVerifies.clear();
}

function executer() {
  reinitialiser();

  const contenu = lecteur(LOCKFILE);
  if (contenu === null) {
    erreur(
      LOCKFILE,
      'lockfile illisible — la porte ne garde rien.',
      'ce script se lance depuis la racine d’un clone git.',
    );
    return { attendus: [...faitsVerifies] };
  }

  const parNom = versionsParPaquet(contenu);
  if (parNom.size === 0) {
    erreur(
      LOCKFILE,
      'aucune entrée lue dans la section `packages:` — l’analyse est cassée ou le lockfile a changé de forme.',
      'vérifier `versionsParPaquet()` contre la version de lockfile produite par `packageManager`.',
    );
    return { attendus: [...faitsVerifies] };
  }
  faitsVerifies.add('lockfile-analyse');

  // La liste a-t-elle encore prise sur le dépôt ? Une liste dont plus AUCUN
  // paquet n'existe est une liste morte, et une porte qui ne garde rien.
  const presents = IDENTITES_UNIQUES.filter(({ paquet }) => parNom.has(paquet));
  if (presents.length === 0) {
    erreur(
      'scripts/verifier-doublons.mjs',
      'aucun des paquets de `IDENTITES_UNIQUES` n’apparaît dans le lockfile — la liste est morte.',
      'paquets renommés ou retirés ? la liste doit suivre, sinon la porte est décorative.',
    );
    return { attendus: [...faitsVerifies] };
  }
  faitsVerifies.add('identites-confrontees');

  for (const { paquet } of IDENTITES_UNIQUES) {
    if (!parNom.has(paquet)) {
      avertir(
        LOCKFILE,
        `\`${paquet}\` est déclaré à identité unique mais n’est plus dans l’arbre.`,
        'dépendance retirée ? retirer aussi son entrée de `IDENTITES_UNIQUES`.',
      );
    }
  }

  // --- Les tolérances d'abord : une tolérance périmée doit se voir MÊME si le
  // --- doublon qu'elle couvre a disparu entre-temps.
  const jour = aujourdhui();
  /** @type {Map<string, { versions: string[], raison: string }>} */
  const tolerees = new Map();
  const declares = new Set(IDENTITES_UNIQUES.map((e) => e.paquet));

  for (const tolerance of TOLERANCES) {
    const { paquet, versions, raison, jusquau } = tolerance;
    if (!declares.has(paquet)) {
      erreur(
        'scripts/verifier-doublons.mjs',
        `tolérance pour \`${paquet}\`, qui n’est pas déclaré à identité unique — elle ne couvre rien.`,
        'retirer la tolérance, ou ajouter le paquet à `IDENTITES_UNIQUES`.',
      );
      continue;
    }
    const echeance = jourValide(jusquau);
    if (echeance === null) {
      erreur(
        'scripts/verifier-doublons.mjs',
        `tolérance pour \`${paquet}\` sans date d’expiration lisible (\`jusquau\` = ${JSON.stringify(jusquau)}).`,
        'une tolérance sans date est un oubli permanent : écrire `jusquau: "AAAA-MM-JJ"`.',
      );
      continue;
    }
    if (echeance.getTime() < jour.getTime()) {
      erreur(
        'scripts/verifier-doublons.mjs',
        `tolérance pour \`${paquet}\` PÉRIMÉE le ${jusquau} — ${raison}`,
        'traiter le doublon, ou redater la tolérance avec la raison de la prolongation. Ne pas la laisser filer sans décision.',
      );
      continue;
    }
    tolerees.set(paquet, { versions, raison });
    const reste = Math.floor(
      (echeance.getTime() - jour.getTime()) / 86_400_000,
    );
    if (reste <= 14) {
      avertir(
        'scripts/verifier-doublons.mjs',
        `tolérance pour \`${paquet}\` : ${reste} jour(s) avant expiration (${jusquau}).`,
        'préparer le remède ou la décision de prolongation maintenant, pas le jour où la porte rougit.',
      );
    }
  }
  faitsVerifies.add('tolerances-datees');

  // --- Le verdict : un paquet à identité unique porté en plusieurs versions.
  for (const { paquet, raison } of IDENTITES_UNIQUES) {
    const versions = parNom.get(paquet);
    if (versions === undefined || versions.size <= 1) {
      const tolerance = tolerees.get(paquet);
      if (tolerance !== undefined) {
        avertir(
          'scripts/verifier-doublons.mjs',
          `tolérance INUTILISÉE pour \`${paquet}\` : le doublon a disparu.`,
          'retirer l’entrée de `TOLERANCES` — une allowlist qu’on ne nettoie pas finit par masquer une vraie récurrence.',
        );
      }
      continue;
    }
    const liste = [...versions].sort().join(', ');
    const tolerance = tolerees.get(paquet);
    if (tolerance !== undefined) {
      const attendues = [...tolerance.versions].sort().join(', ');
      if (attendues === liste) continue;
      erreur(
        LOCKFILE,
        `\`${paquet}\` est résolu en ${versions.size} versions (${liste}), alors que la tolérance ne couvre que ${attendues}.`,
        'le doublon a CHANGÉ : ce n’est plus celui qui a été accepté. Réexaminer plutôt qu’élargir la tolérance par réflexe.',
      );
      continue;
    }
    erreur(
      LOCKFILE,
      `\`${paquet}\` est résolu en ${versions.size} versions (${liste}) — ${raison}`,
      'poser un override pnpm (`package.json` → `pnpm.overrides`), ou aligner la dépendance qui tire l’autre version. Si le doublon est acceptable pour un temps, l’écrire dans `TOLERANCES` AVEC une date.',
    );
  }
  faitsVerifies.add('doublons-juges');

  return { attendus: [...faitsVerifies] };
}

/** @param {{ attendus: string[] }} bilan */
function conclure({ attendus }) {
  const ATTENDUS = [
    'lockfile-analyse',
    'identites-confrontees',
    'tolerances-datees',
    'doublons-juges',
  ];
  for (const fait of ATTENDUS) {
    if (!attendus.includes(fait)) {
      erreur(
        'balayage',
        `le contrôle « ${fait} » n’a pas eu lieu — la porte a rendu un verdict sans regarder.`,
      );
    }
  }
  for (const { portee, message, remede } of avertissements) {
    console.warn(`⚠️  ${portee} — ${message}`);
    if (remede !== undefined) console.warn(`    → ${remede}`);
  }
  for (const { portee, message, remede } of erreurs) {
    console.error(`❌ ${portee} — ${message}`);
    if (remede !== undefined) console.error(`    → ${remede}`);
  }
  if (erreurs.length === 0) {
    console.log(
      `✅ ${IDENTITES_UNIQUES.length} identité(s) unique(s) confrontée(s) au lockfile, ${TOLERANCES.length} tolérance(s) datée(s).`,
    );
  }
  console.log(
    `\n  ${erreurs.length} erreur(s), ${avertissements.length} avertissement(s).`,
  );
  process.exitCode = erreurs.length === 0 ? 0 : 1;
}

// ---------------------------------------------------------------------------
// Sondes négatives — chacune abîme l'entrée de la porte et exige qu'elle morde.
// Une porte sans sonde finit par ne plus rien garder sans que personne le voie.
// ---------------------------------------------------------------------------

/**
 * @type {{ nom: string, abimer?: (texte: string) => string, illisible?: boolean,
 *          jour?: string, attendu: RegExp }[]}
 */
const SONDES = [
  {
    nom: 'seconde version d’un paquet à identité unique',
    abimer: (texte) =>
      texte.replace(
        "  '@nestjs/common@",
        "  '@nestjs/common@9.0.0':\n    resolution: {integrity: sha512-sonde}\n  '@nestjs/common@",
      ),
    attendu: /`@nestjs\/common` est résolu en 2 versions/,
  },
  {
    nom: 'section `packages:` introuvable',
    // `\r?` : sur un poste Windows le fichier est en CRLF, et une sonde qui
    // suppose LF perd sa cible sans que le verdict change (piège `EM-07`).
    abimer: (texte) => texte.replace(/\npackages:(\r?\n)/, '\npaquets:$1'),
    attendu: /aucune entrée lue dans la section `packages:`/,
  },
  {
    nom: 'lockfile illisible',
    illisible: true,
    attendu: /lockfile illisible/,
  },
  {
    nom: 'tolérance périmée',
    jour: '2027-06-01',
    attendu: /tolérance pour `rxjs` PÉRIMÉE/,
  },
  {
    nom: 'le doublon toléré n’est plus le même',
    abimer: (texte) => texte.replace('  rxjs@7.8.2:', '  rxjs@7.9.0:'),
    attendu: /la tolérance ne couvre que/,
  },
];

if (process.argv.includes('--autotest')) {
  process.exitCode = autotest();
} else {
  console.log('Doublons de dépendances à identité unique');
  conclure(executer());
}

/** Rejoue les sondes ; rend 0 si toutes mordent et si le témoin est vert. */
function autotest() {
  const surDisque = lecteur;
  const horlogeReelle = aujourdhui;
  let echecs = 0;

  executer();
  if (erreurs.length > 0) {
    console.error(
      `❌ témoin : l’état réel lève déjà ${erreurs.length} constat(s) — les sondes ne prouveraient rien.`,
    );
    for (const { portee, message } of erreurs) {
      console.error(`   ${portee} — ${message}`);
    }
    echecs += 1;
  }

  for (const sonde of SONDES) {
    const origine = surDisque(LOCKFILE);
    if (origine === null) {
      console.error(
        `❌ sonde « ${sonde.nom} » : ${LOCKFILE} illisible — la sonde a perdu sa cible.`,
      );
      echecs += 1;
      continue;
    }

    if (sonde.illisible === true) {
      lecteur = () => null;
    } else if (sonde.abimer !== undefined) {
      const abime = sonde.abimer(origine);
      if (abime === origine) {
        console.error(
          `❌ sonde « ${sonde.nom} » : la mutation n’a rien changé — la ligne visée a bougé.`,
        );
        echecs += 1;
        continue;
      }
      lecteur = (relatif) => (relatif === LOCKFILE ? abime : surDisque(relatif));
    }
    if (sonde.jour !== undefined) {
      const fige = new Date(`${sonde.jour}T00:00:00Z`);
      aujourdhui = () => fige;
    }

    executer();
    lecteur = surDisque;
    aujourdhui = horlogeReelle;

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
