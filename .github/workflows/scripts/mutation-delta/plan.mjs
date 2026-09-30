// @ts-check
/**
 * PLAN du gate de mutation sur le code modifié — module PUR (aucun git, aucun
 * fichier, aucun processus). Il reçoit ce que git a répondu et rend, pour chaque
 * lib mutée, ce qu'il faut exécuter et pourquoi.
 *
 * Trois modes par lib :
 *   - `rien`    : la PR ne touche pas le code muté de la lib → aucun run ;
 *   - `delta`   : mutation des SEULES lignes ajoutées ou modifiées (plages
 *                 `fichier:début-fin` passées à `--mutate`) ;
 *   - `complet` : REPLI sur le run complet de la lib, dans les cas où le delta
 *                 ne serait pas fiable (§5.2 de la proposition) :
 *                   1. base de comparaison introuvable ;
 *                   2. configuration de test ou de mutation modifiée ;
 *                   3. seuls des fichiers de test changent (le delta de source
 *                      est vide alors que les tests ont pu être affaiblis) ;
 *                   4. le code du gate lui-même est modifié (il se juge en entier).
 *
 * Les renommages sont détectés par git (`-M`) : un fichier déplacé ne contribue
 * que ses lignes réellement modifiées, jamais son code ancien.
 *
 * Règle cardinale : un DOUTE ne produit jamais `rien`. Il produit `complet`.
 */
import { matchesGlob } from 'node:path';

/**
 * @typedef {{ dossier: string, projet: string, mutate: string[] }} Lib
 * @typedef {{ statut: string, chemin: string, ancien: string | null }} Changement
 * @typedef {{ mode: 'rien' | 'delta' | 'complet', raison: string, mutate: string[] }} PlanLib
 */

/** Fichiers dont la modification rend le delta non fiable, relatifs à la lib. */
const CONFIG_LIB = [
  /^stryker\.config\.[cm]?[jt]s$/,
  /^vitest\.config\.[cm]?[jt]s$/,
  /^vite\.config\.[cm]?[jt]s$/,
  /^tsconfig(\.[a-z]+)?\.json$/,
  /^package\.json$/,
];

/** Fichiers de la racine dont la modification rend TOUT delta non fiable. */
const CONFIG_RACINE = [
  /^vitest\.config\.[cm]?[jt]s$/,
  /^vitest\.workspace\.[cm]?[jt]s$/,
];

/**
 * Le gate lui-même : modifier son code le fait se juger sur tout. Volontairement
 * PAS `ci.yml` : le rejeu historique a montré qu'un changement de `ci.yml` sans
 * rapport avec la mutation (48 PR sur 66) masquait le delta sous un run complet —
 * trois PR qui touchaient aussi du code de domaine n'avaient pas été jugées sur
 * leurs lignes. Les tests du gate tournent de toute façon en tête du job.
 */
const GATE = /^\.github\/workflows\/scripts\/mutation-delta\//;

const EST_TEST = /\.(spec|test)\.[cm]?[jt]sx?$/;

/**
 * `git diff --name-status -M` → changements. Les lignes `R087\tancien\tnouveau`
 * deviennent un renommage ; les autres `X\tchemin`.
 *
 * @param {string} sortie
 * @returns {Changement[]}
 */
export function lireNomsStatuts(sortie) {
  /** @type {Changement[]} */
  const out = [];
  for (const ligne of String(sortie).split(/\r?\n/)) {
    if (ligne.trim() === '') continue;
    const [statut, a, b] = ligne.split('\t');
    if (statut.startsWith('R') || statut.startsWith('C')) {
      out.push({ statut: statut[0], chemin: b ?? '', ancien: a ?? null });
    } else {
      out.push({ statut: statut[0], chemin: a ?? '', ancien: null });
    }
  }
  return out;
}

/**
 * `git diff -U0 -M` → plages de lignes ajoutées/modifiées côté NOUVEAU, par
 * fichier. Un hunk `+a,0` (suppression pure) ne produit rien.
 *
 * @param {string} diff
 * @returns {Map<string, [number, number][]>}
 */
export function lirePlages(diff) {
  /** @type {Map<string, [number, number][]>} */
  const plages = new Map();
  let courant = null;
  for (const ligne of String(diff).split(/\r?\n/)) {
    if (ligne.startsWith('+++ ')) {
      const chemin = ligne.slice(4).trim();
      courant = chemin === '/dev/null' ? null : chemin.replace(/^b\//, '');
      if (courant !== null && !plages.has(courant)) plages.set(courant, []);
      continue;
    }
    const hunk = /^@@ -\d+(?:,\d+)? \+(\d+)(?:,(\d+))? @@/.exec(ligne);
    if (hunk && courant !== null) {
      const debut = Number(hunk[1]);
      const nombre = hunk[2] === undefined ? 1 : Number(hunk[2]);
      if (nombre > 0) plages.get(courant)?.push([debut, debut + nombre - 1]);
    }
  }
  return plages;
}

/**
 * Le fichier (relatif à la lib) fait-il partie du code muté selon la config ?
 * Motifs Stryker : positifs, puis négatifs préfixés de `!`.
 *
 * @param {string} relatif
 * @param {string[]} motifs
 */
export function estMute(relatif, motifs) {
  let dedans = false;
  for (const m of motifs) {
    if (m.startsWith('!')) {
      if (matchesGlob(relatif, m.slice(1))) dedans = false;
    } else if (matchesGlob(relatif, m)) {
      dedans = true;
    }
  }
  return dedans;
}

/**
 * @param {{
 *   libs: Lib[],
 *   baseTrouvee: boolean,
 *   changements: Changement[],
 *   plages: Map<string, [number, number][]>,
 *   outillageModifie: boolean,
 * }} entree `outillageModifie` : une version de Stryker ou de Vitest a changé
 *   dans le `package.json` racine (calculé par l'appelant sur le diff).
 * @returns {Map<string, PlanLib>}
 */
export function planifier({
  libs,
  baseTrouvee,
  changements,
  plages,
  outillageModifie,
}) {
  /** @type {Map<string, PlanLib>} */
  const plan = new Map();

  // Replis globaux : toutes les libs en complet.
  /** @type {string | null} */
  let replisGlobal = null;
  if (!baseTrouvee)
    replisGlobal = 'base de comparaison introuvable (git merge-base)';
  else if (outillageModifie)
    replisGlobal = 'version de Stryker ou de Vitest modifiée';
  else if (
    changements.some((c) => CONFIG_RACINE.some((r) => r.test(c.chemin)))
  ) {
    replisGlobal = 'configuration de test racine modifiée';
  } else if (
    changements.some(
      (c) => GATE.test(c.chemin) || (c.ancien !== null && GATE.test(c.ancien)),
    )
  ) {
    replisGlobal = 'le gate de mutation lui-même est modifié';
  }

  for (const lib of libs) {
    if (replisGlobal !== null) {
      plan.set(lib.dossier, {
        mode: 'complet',
        raison: replisGlobal,
        mutate: [],
      });
      continue;
    }
    const prefixe = `${lib.dossier}/`;
    const relatifs = changements
      .filter(
        (c) =>
          c.chemin.startsWith(prefixe) || (c.ancien ?? '').startsWith(prefixe),
      )
      .map((c) => ({
        ...c,
        rel: c.chemin.startsWith(prefixe)
          ? c.chemin.slice(prefixe.length)
          : null,
        relAncien: c.ancien?.startsWith(prefixe)
          ? c.ancien.slice(prefixe.length)
          : null,
      }));

    if (
      relatifs.some((c) =>
        [c.rel, c.relAncien].some(
          (r) => r !== null && CONFIG_LIB.some((x) => x.test(r)),
        ),
      )
    ) {
      plan.set(lib.dossier, {
        mode: 'complet',
        raison: 'configuration de test ou de mutation de la lib modifiée',
        mutate: [],
      });
      continue;
    }

    const sources = relatifs.filter(
      (c) =>
        c.statut !== 'D' &&
        c.rel !== null &&
        !EST_TEST.test(c.rel) &&
        estMute(c.rel, lib.mutate),
    );
    const sourcesSupprimees = relatifs.filter(
      (c) =>
        c.statut === 'D' &&
        c.rel !== null &&
        !EST_TEST.test(c.rel) &&
        estMute(c.rel, lib.mutate),
    );
    const tests = relatifs.filter((c) =>
      [c.rel, c.relAncien].some((r) => r !== null && EST_TEST.test(r)),
    );

    /** @type {string[]} */
    const mutate = [];
    for (const s of sources) {
      for (const [a, b] of plages.get(`${lib.dossier}/${s.rel}`) ?? [])
        mutate.push(`${s.rel}:${a}-${b}`);
    }

    if (mutate.length > 0) {
      plan.set(lib.dossier, {
        mode: 'delta',
        raison: `${mutate.length} plage(s) modifiée(s) dans ${sources.length} fichier(s)`,
        mutate,
      });
    } else if (tests.length > 0) {
      plan.set(lib.dossier, {
        mode: 'complet',
        raison:
          'seuls des fichiers de test changent : le delta de source est vide, les tests ont pu être affaiblis',
        mutate: [],
      });
    } else if (sources.length > 0 || sourcesSupprimees.length > 0) {
      plan.set(lib.dossier, {
        mode: 'rien',
        raison:
          'suppressions seules dans le code muté : aucune ligne nouvelle à juger',
        mutate: [],
      });
    } else {
      plan.set(lib.dossier, {
        mode: 'rien',
        raison: 'code muté non touché',
        mutate: [],
      });
    }
  }
  return plan;
}

/**
 * Une version de Stryker ou de Vitest a-t-elle changé ? Lit les lignes +/- du
 * diff `-U0` du `package.json` racine.
 *
 * @param {string} diffPackageJson
 */
export function outillageModifie(diffPackageJson) {
  return String(diffPackageJson)
    .split(/\r?\n/)
    .some(
      (l) =>
        /^[+-](?![+-])/.test(l) &&
        /"(@stryker-mutator\/[^"]+|vitest|@vitest\/[^"]+)"\s*:/.test(l),
    );
}
