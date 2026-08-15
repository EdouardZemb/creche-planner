#!/usr/bin/env node
// @ts-check
/**
 * Porte de la **quarantaine des publications npm** (`AM-50`, lot 8 des standards).
 *
 * ## Pourquoi ce script existe
 *
 * Le dépôt fait attendre 3 jours avant d'installer une version fraîchement
 * publiée (`minimumReleaseAge`, `pnpm-workspace.yaml`) : c'est la fenêtre que
 * visent les compromissions de compte de mainteneur. Ce réglage a deux façons
 * de devenir **inerte sans qu'aucune commande ne le dise** :
 *
 *  1. **au mauvais endroit.** L'énoncé d'origine d'`AM-50` demandait de le poser
 *     dans `.npmrc` — or depuis pnpm 10.16 les réglages propres à pnpm se lisent
 *     dans `pnpm-workspace.yaml`, et une ligne inconnue de `.npmrc` est ignorée
 *     en silence. Mesuré sur le pnpm du dépôt : un délai de 350 jours en
 *     `.npmrc` laisse résoudre `typescript@5.9.3` (publié depuis 318 jours) ; la
 *     même ligne dans `pnpm-workspace.yaml` résout `5.9.2` ;
 *  2. **désaccordé de Dependabot.** Un délai pnpm plus long que le cooldown de
 *     Dependabot fait diverger la plage du manifeste (que Dependabot vient de
 *     remonter) et la version que pnpm accepte de résoudre sur les plages larges
 *     (`eslint: ^9`) : la mise à jour proposée n'est alors pas celle qui
 *     s'installe.
 *
 * ## Ce que la porte garantit
 *
 * 1. `pnpm-workspace.yaml` déclare un `minimumReleaseAge` entier et non nul ;
 * 2. `.npmrc` n'en porte AUCUNE trace — le placement inerte est interdit, pas
 *    seulement déconseillé ;
 * 3. le `packageManager` du dépôt est ≥ 10.16, version qui a introduit le
 *    réglage : sous cette version, la ligne serait inerte pour une autre raison ;
 * 4. le bloc `npm` de `.github/dependabot.yml` déclare un `cooldown.default-days`
 *    dont la valeur, convertie en minutes, ÉGALE le délai pnpm. L'attendu est
 *    **dérivé** des deux fichiers, jamais recopié ici.
 *
 * ## Ce que la porte NE garantit **pas**
 *
 *  - Elle ne prouve pas que le délai **mord** : cela se constate en résolvant
 *    une dépendance, ce qu'une porte hors réseau ne peut pas faire (le constat a
 *    été joué à la main pendant le lot 8, en comparant les deux placements).
 *  - Elle ne dit rien de la **valeur** : 3 jours est un arbitrage aligné sur le
 *    cooldown de Dependabot, pas une exigence.
 *  - Elle ne couvre pas les mises à jour de **sécurité** de Dependabot, qui
 *    ignorent le cooldown par conception : sur une plage large, la résolution
 *    peut alors retenir une version antérieure au correctif, et l'échappatoire
 *    (`minimumReleaseAgeExclude`) est un geste humain.
 *  - Elle ne regarde ni le lockfile, ni les `overrides`, ni l'écosystème
 *    `github-actions` (le délai pnpm ne l'atteint pas).
 *
 * ## Usage
 *   pnpm quarantaine              # vérifie (exit 1 si un constat)
 *   pnpm quarantaine --autotest   # rejoue les sondes négatives
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

const FICHIERS = [
  'pnpm-workspace.yaml',
  '.npmrc',
  'package.json',
  '.github/dependabot.yml',
];

/** Version de pnpm qui a introduit `minimumReleaseAge`. */
const PNPM_MINIMUM = [10, 16, 0];

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
 * `default-days` du bloc `package-ecosystem: 'npm'` de dependabot.yml.
 *
 * Analyse ligne à ligne (zéro dépendance) : on suit les blocs de `updates:` et
 * on ne retient le `cooldown:` que du bloc dont l'écosystème est `npm`.
 *
 * @param {string} contenu
 * @returns {{ ecosystemes: string[], jours: number | null }}
 */
function cooldownNpm(contenu) {
  /** @type {string[]} */
  const ecosystemes = [];
  let dansNpm = false;
  let dansCooldown = false;
  let jours = null;
  for (const ligne of contenu.split(/\r?\n/)) {
    const ecosysteme = /^\s*-\s*package-ecosystem:\s*['"]?([a-z-]+)['"]?/.exec(
      ligne,
    );
    if (ecosysteme !== null) {
      ecosystemes.push(ecosysteme[1]);
      dansNpm = ecosysteme[1] === 'npm';
      dansCooldown = false;
      continue;
    }
    if (!dansNpm) continue;
    if (/^\s{4}cooldown:\s*$/.test(ligne)) {
      dansCooldown = true;
      continue;
    }
    if (/^\s{4}[a-z-]+:/.test(ligne)) {
      dansCooldown = false;
    }
    const valeur = /^\s{6}default-days:\s*(\d+)\s*$/.exec(ligne);
    if (dansCooldown && valeur !== null) {
      jours = Number(valeur[1]);
    }
  }
  return { ecosystemes, jours };
}

/**
 * @param {Record<string, string>} contenus
 * @returns {string[]}
 */
function verifier(contenus) {
  /** @type {string[]} */
  const constats = [];

  const declare = /^minimumReleaseAge:\s*(\d+)\s*$/m.exec(
    contenus['pnpm-workspace.yaml'],
  );
  const delai = declare === null ? null : Number(declare[1]);
  if (delai === null || delai === 0) {
    constats.push(
      "pnpm-workspace.yaml ne déclare aucun `minimumReleaseAge` non nul : une version npm publiée à l'instant redevient installable à la seconde, y compris en transitif (AM-50).",
    );
  }

  if (/^\s*minimum-?release-?age/im.test(contenus['.npmrc'])) {
    constats.push(
      "`.npmrc` porte un réglage `minimumReleaseAge` : depuis pnpm 10.16 ce fichier n'est plus lu pour les réglages pnpm, la ligne y est IGNORÉE SANS MESSAGE. La déplacer dans pnpm-workspace.yaml.",
    );
  }

  const gestionnaire = /"packageManager":\s*"pnpm@(\d+)\.(\d+)\.(\d+)"/.exec(
    contenus['package.json'],
  );
  if (gestionnaire === null) {
    constats.push(
      'package.json ne fige aucun `packageManager` pnpm : la porte ne peut pas dire si le réglage de quarantaine est seulement lisible par le pnpm du dépôt.',
    );
  } else {
    const version = [1, 2, 3].map((i) => Number(gestionnaire[i]));
    const trop_vieux = version.some(
      (v, i) =>
        v < PNPM_MINIMUM[i] &&
        version.slice(0, i).every((w, j) => w === PNPM_MINIMUM[j]),
    );
    if (trop_vieux) {
      constats.push(
        `packageManager = pnpm@${version.join('.')} : \`minimumReleaseAge\` n'existe que depuis pnpm ${PNPM_MINIMUM.join('.')} — le réglage serait inerte.`,
      );
    }
  }

  const { ecosystemes, jours } = cooldownNpm(
    contenus['.github/dependabot.yml'],
  );
  if (ecosystemes.length === 0) {
    constats.push(
      'aucun `package-ecosystem` trouvé dans .github/dependabot.yml : le balayage ne mord plus (nommage ou indentation changés ?).',
    );
  } else if (!ecosystemes.includes('npm')) {
    constats.push(
      "aucun bloc `package-ecosystem: 'npm'` dans .github/dependabot.yml : plus rien ne propose de mise à jour des dépendances applicatives.",
    );
  } else if (jours === null) {
    constats.push(
      "le bloc npm de .github/dependabot.yml ne déclare pas de `cooldown.default-days` : le délai de Dependabot redevient un DÉFAUT de plateforme, que rien n'accorde au `minimumReleaseAge` du dépôt.",
    );
  } else if (delai !== null && jours * 1440 !== delai) {
    constats.push(
      `désaccord de quarantaine : Dependabot attend ${jours} jour(s) (${jours * 1440} min) et pnpm ${delai} min. Une version proposée par l'un que l'autre refuse de résoudre fait diverger le manifeste et le lockfile sur les plages larges — aligner les deux valeurs.`,
    );
  }

  return constats;
}

/** @param {Record<string, string>} contenus */
function autotest(contenus) {
  /**
   * Mutation d'un fichier réel, avec **garde** : une mutation qui ne change rien
   * fait échouer la sonde ici, au lieu de laisser la porte « ne pas mordre » sur
   * un fichier intact et d'accuser la porte (piège CRLF, `LE-33`).
   *
   * @param {string} fichier
   * @param {(texte: string) => string} transformation
   * @param {string} etiquette
   * @returns {Record<string, string>}
   */
  function muter(fichier, transformation, etiquette) {
    const source = contenus[fichier];
    const mute = transformation(source);
    if (mute === source) {
      throw new Error(
        `sonde « ${etiquette} » : la mutation n'a RIEN changé — la sonde est périmée (motif introuvable dans le fichier réel), pas la porte.`,
      );
    }
    return { ...contenus, [fichier]: mute };
  }

  /** Délai réellement déclaré : dérivé, jamais écrit en dur. */
  const delai = Number(
    /^minimumReleaseAge:\s*(\d+)\s*$/m.exec(
      contenus['pnpm-workspace.yaml'],
    )?.[1],
  );

  /** @type {{ nom: string, constats: string[], attendu: string }[]} */
  const sondes = [];

  sondes.push({
    nom: 'réglage retiré',
    constats: verifier(
      muter(
        'pnpm-workspace.yaml',
        (t) => t.replace(/^minimumReleaseAge:.*$/m, ''),
        'réglage retiré',
      ),
    ),
    attendu: 'aucun `minimumReleaseAge` non nul',
  });

  sondes.push({
    nom: 'réglage déplacé dans .npmrc (placement inerte)',
    constats: verifier(
      muter(
        '.npmrc',
        (t) => `${t}minimumReleaseAge=${delai}\n`,
        'réglage en .npmrc',
      ),
    ),
    attendu: 'IGNORÉE SANS MESSAGE',
  });

  sondes.push({
    nom: 'cooldown Dependabot désaligné',
    constats: verifier(
      muter(
        '.github/dependabot.yml',
        (t) => t.replace(/default-days: \d+/, 'default-days: 7'),
        'cooldown désaligné',
      ),
    ),
    attendu: 'désaccord de quarantaine',
  });

  sondes.push({
    nom: 'cooldown Dependabot retiré',
    constats: verifier(
      muter(
        '.github/dependabot.yml',
        (t) => t.replace(/\r?\n\s{4}cooldown:\r?\n\s{6}default-days: \d+/, ''),
        'cooldown retiré',
      ),
    ),
    attendu: 'ne déclare pas de `cooldown.default-days`',
  });

  sondes.push({
    nom: 'pnpm rétrogradé sous la version qui lit le réglage',
    constats: verifier(
      muter(
        'package.json',
        (t) =>
          t.replace(
            /"packageManager": "pnpm@\d+\.\d+\.\d+"/,
            '"packageManager": "pnpm@10.15.0"',
          ),
        'pnpm rétrogradé',
      ),
    ),
    attendu: 'serait inerte',
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
  /** @type {Record<string, string>} */
  const contenus = {};
  for (const fichier of FICHIERS) {
    contenus[fichier] = lire(fichier);
  }

  if (process.argv.includes('--autotest')) {
    return autotest(contenus);
  }

  const constats = verifier(contenus);
  if (constats.length > 0) {
    console.error(
      `Quarantaine des publications npm — ${constats.length} constat(s) :`,
    );
    for (const constat of constats) {
      console.error(`  - ${constat}`);
    }
    return 1;
  }

  const delai = Number(
    /^minimumReleaseAge:\s*(\d+)\s*$/m.exec(
      contenus['pnpm-workspace.yaml'],
    )?.[1],
  );
  console.log(
    `Quarantaine des publications npm : ${delai} min (${delai / 1440} j) déclarés dans pnpm-workspace.yaml, ` +
      `accordés au cooldown Dependabot, aucun réglage inerte en .npmrc.`,
  );
  return 0;
}

process.exitCode = principal();
