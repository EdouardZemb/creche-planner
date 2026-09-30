// @ts-check
/**
 * TRI DES PR DEPENDABOT — la politique de fusion, en un seul endroit.
 *
 * Ce module est PUR : aucune lecture réseau, aucun effet de bord. Il reçoit ce
 * que l'API GitHub a répondu et rend une décision motivée. Deux consommateurs :
 *
 *   - `fusion.mjs` fusionne une PR si, et seulement si, la décision est `prete` ;
 *   - `situation.mjs` affiche, pour chaque PR non fusionnée, la RAISON du blocage.
 *
 * Une seule source de vérité : la raison affichée dans le récapitulatif est
 * exactement celle qui a empêché la fusion, jamais une reconstitution.
 *
 * ── POLITIQUE (arbitrée par le propriétaire du dépôt) ───────────────────────
 *   - fusion automatique : mises à jour npm CORRECTIF et MINEURE, tous gates verts ;
 *   - JAMAIS de fusion automatique d'une mise à jour de SÉCURITÉ, même en patch ;
 *   - à la main : majeures, échecs de CI, et tout ce qui touche un gate.
 *
 * ── RÈGLE CARDINALE : UN DOUTE BLOQUE ───────────────────────────────────────
 * Tout ce qui ne se lit pas avec certitude (métadonnées absentes, version de
 * départ introuvable, avis de sécurité non consultables, contrôle manquant)
 * produit un BLOCAGE motivé, jamais une fusion. L'erreur qu'on refuse d'écrire
 * ici est celle qui rendrait la politique silencieusement permissive.
 */

export const AUTEUR_DEPENDABOT = 'dependabot[bot]';

/**
 * Outillage qui EXÉCUTE ou DÉFINIT un gate : lint, format, types, tests,
 * mutation, contrats, accessibilité, messages de commit, chaîne Nx.
 *
 * Pourquoi c'est à la main même en patch : quand l'outil d'un gate change, un
 * gate vert ne prouve plus rien — une règle retirée ou un comparateur relâché
 * rend le contrôle PLUS vert précisément parce qu'il contrôle moins.
 *
 * ⚠️ Cette liste est recopiée TELLE QUELLE dans le groupe `outillage-portes` de
 * `.github/dependabot.yml`, pour que ces paquets arrivent dans leur propre PR au
 * lieu de bloquer tout un groupe. Le test `tri.test.mjs` refuse tout écart.
 */
export const OUTILLAGE_PORTES = [
  'nx',
  '@nx/*',
  'eslint',
  'eslint-*',
  '@eslint/*',
  'typescript-eslint',
  '@typescript-eslint/*',
  'jsonc-eslint-parser',
  'prettier',
  'prettier-*',
  '@commitlint/*',
  'husky',
  'lint-staged',
  'typescript',
  'vitest',
  '@vitest/*',
  '@stryker-mutator/*',
  '@pact-foundation/*',
  'playwright',
  '@playwright/*',
  '@axe-core/*',
  '@testing-library/*',
  'fast-check',
  'openapi-typescript',
];

/**
 * Fichiers qu'une PR fusionnable a le droit de toucher : manifestes npm et
 * lockfile. Tout autre fichier (workflow, script, Dockerfile, config) sort du
 * périmètre automatique — en particulier `.github/**`, qui contient les gates
 * ET ce workflow de fusion lui-même.
 */
const FICHIERS_AUTORISES = [
  /^pnpm-lock\.yaml$/,
  /^package\.json$/,
  /^(apps|libs)\/(?:[a-z0-9-]+\/){1,2}package\.json$/,
];

/**
 * Contrôles qui DOIVENT avoir rendu un verdict sur le commit de tête. Sans
 * cette liste, un contrôle qui n'a pas encore démarré serait simplement absent,
 * et « tous les contrôles présents sont verts » deviendrait vrai trop tôt.
 * `config-validation` peut être `skipped` (aucun fichier de config touché) :
 * c'est un verdict, la protection de branche le compte comme réussi.
 */
export const CONTROLES_ATTENDUS = [
  'ci',
  'config-validation',
  'security',
  'secret-scan',
  'sast-semgrep',
  'Analyse CodeQL (javascript-typescript)',
  // Requis sur main depuis #388 (ratchet ESLint sorti du job `ci`, mutation des
  // lignes modifiées) : sans eux ici, le tri fusionnerait avant leur verdict.
  'lint-ratchet',
  'mutation-delta',
];

/** Conclusions de contrôle acceptées comme « vert ». Liste fermée. */
const CONCLUSIONS_VERTES = new Set(['success', 'skipped']);

/** @param {string} motif motif Dependabot (`*` seul joker) */
function versRegex(motif) {
  const echappe = motif.replace(/[.+?^${}()|[\]\\/]/g, '\\$&');
  return new RegExp(`^${echappe.replace(/\*/g, '.*')}$`);
}

const REGEX_PORTES = OUTILLAGE_PORTES.map(versRegex);

/** @param {string} nom */
export function toucheUnGate(nom) {
  return REGEX_PORTES.some((r) => r.test(nom));
}

/**
 * @typedef {{ nom: string, versionCible: string | null, typeDependance: string | null, typeMaj: string | null }} DependanceMaj
 */

/**
 * Lit le bloc YAML `updated-dependencies:` que Dependabot écrit dans son
 * message de commit. Analyse ligne à ligne, volontairement étroite : un format
 * inattendu donne une liste VIDE, que l'appelant traite comme un blocage.
 *
 * @param {string} message
 * @returns {DependanceMaj[]}
 */
export function lireMetadonnees(message) {
  const lignes = String(message ?? '').split(/\r?\n/);
  const debut = lignes.findIndex((l) => l.trim() === 'updated-dependencies:');
  if (debut === -1) return [];
  /** @type {DependanceMaj[]} */
  const deps = [];
  /** @type {DependanceMaj | null} */
  let courante = null;
  for (const ligne of lignes.slice(debut + 1)) {
    if (ligne.trim() === '...' || ligne.trim() === '---') break;
    const nouvelle = /^-\s+dependency-name:\s*"?([^"]+?)"?\s*$/.exec(ligne);
    if (nouvelle) {
      courante = {
        nom: nouvelle[1],
        versionCible: null,
        typeDependance: null,
        typeMaj: null,
      };
      deps.push(courante);
      continue;
    }
    const champ = /^\s+([a-z-]+):\s*"?([^"]*?)"?\s*$/.exec(ligne);
    if (!champ || courante === null) continue;
    if (champ[1] === 'dependency-version') courante.versionCible = champ[2];
    if (champ[1] === 'dependency-type') courante.typeDependance = champ[2];
    if (champ[1] === 'update-type') courante.typeMaj = champ[2];
  }
  return deps;
}

/**
 * Versions de DÉPART, lues dans le corps de la PR. Trois tournures Dependabot :
 *   - « Bumps [nom](url) from 1.2.3 to 1.2.4. »       (PR simple)
 *   - « Updates `nom` from 1.2.3 to 1.2.4 »           (PR groupée)
 *   - « | [nom](url) | `1.2.3` | `1.2.4` | »           (tableau d'une PR groupée)
 *
 * Le corps contient aussi des notes de version rédigées par les auteurs des
 * paquets : c'est une donnée NON FIABLE. On n'en extrait que des couples
 * nom/version par motifs stricts ; un désaccord entre deux tournures pour le
 * même paquet invalide l'entrée (l'appelant bloque).
 *
 * @param {string} corps
 * @returns {Map<string, string>}
 */
export function lireVersionsDepart(corps) {
  const texte = String(corps ?? '');
  /** @type {Map<string, string>} */
  const versions = new Map();
  /** @type {Set<string>} */
  const contradictoires = new Set();
  const noter = (/** @type {string} */ nom, /** @type {string} */ v) => {
    const deja = versions.get(nom);
    if (deja !== undefined && deja !== v) contradictoires.add(nom);
    versions.set(nom, v);
  };
  const VERSION = '([0-9][0-9A-Za-z.+-]*)';
  const motifs = [
    new RegExp(
      `^Bumps \\[([^\\]]+)\\]\\([^)]*\\) from ${VERSION} to ${VERSION}\\.?`,
      'gm',
    ),
    new RegExp(`^Bumps ([^\\s\\[]+) from ${VERSION} to ${VERSION}\\.?`, 'gm'),
    new RegExp(`^Updates \`([^\`]+)\` from ${VERSION} to ${VERSION}`, 'gm'),
    new RegExp(
      `^\\|\\s*\\[([^\\]]+)\\]\\([^)]*\\)\\s*\\|\\s*\`${VERSION}\`\\s*\\|\\s*\`${VERSION}\`\\s*\\|`,
      'gm',
    ),
    new RegExp(
      `^\\|\\s*([^|\\s\\[]+)\\s*\\|\\s*\`${VERSION}\`\\s*\\|\\s*\`${VERSION}\`\\s*\\|`,
      'gm',
    ),
  ];
  for (const motif of motifs) {
    for (const m of texte.matchAll(motif)) noter(m[1], m[2]);
  }
  for (const nom of contradictoires) versions.delete(nom);
  return versions;
}

/**
 * @param {string} v
 * @returns {[number, number, number] | null}
 */
function semver(v) {
  const m = /^(\d+)\.(\d+)\.(\d+)(?:[-+].*)?$/.exec(v);
  return m ? [Number(m[1]), Number(m[2]), Number(m[3])] : null;
}

/**
 * Nature RÉELLE d'une montée, calculée sur les versions et non lue dans
 * l'étiquette de Dependabot. Deux corrections par rapport à l'étiquette :
 *
 *   - en `0.y.z`, SemVer §4 autorise toute rupture : `0.79 → 0.80` est étiqueté
 *     « minor » par Dependabot mais se traite comme une MAJEURE ;
 *   - une pré-version (`-beta`, `-rc`) n'est jamais une montée tranquille.
 *
 * @param {string} depart
 * @param {string} cible
 * @returns {'patch' | 'minor' | 'major' | 'illisible'}
 */
export function natureMontee(depart, cible) {
  const a = semver(depart);
  const b = semver(cible);
  if (a === null || b === null) return 'illisible';
  if (/-/.test(cible)) return 'major';
  if (b[0] !== a[0]) return 'major';
  if (a[0] === 0) {
    if (b[1] !== a[1]) return 'major';
    if (a[1] === 0 && b[2] !== a[2]) return 'major';
    return 'patch';
  }
  if (b[1] !== a[1]) return 'minor';
  return 'patch';
}

/** @param {string | null} typeMaj */
function etiquetteDependabot(typeMaj) {
  if (typeMaj === 'version-update:semver-patch') return 'patch';
  if (typeMaj === 'version-update:semver-minor') return 'minor';
  if (typeMaj === 'version-update:semver-major') return 'major';
  return 'illisible';
}

const RANG = { patch: 0, minor: 1, major: 2, illisible: 3 };

/**
 * @typedef {{
 *   numero: number,
 *   titre: string,
 *   auteur: { login: string, type: string },
 *   brancheTete: string,
 *   depotTete: string,
 *   depotBase: string,
 *   brouillon: boolean,
 *   corps: string,
 *   shaTete: string,
 *   etatFusion: string,
 *   ouverteLe: string,
 * }} Pr
 *
 * @typedef {{ sha: string, auteur: string | null, verifie: boolean, message: string }} Commit
 *
 * @typedef {{ nom: string, statut: string, conclusion: string | null }} Controle
 *
 * @typedef {{ nom: string, ok: true, avis: { ghsa: string, severite: string }[] } | { nom: string, ok: false, erreur: string }} Avis
 */

/**
 * @typedef {{
 *   decision: 'prete' | 'securite' | 'a-la-main' | 'attente',
 *   raisons: string[],
 *   dependances: { nom: string, depart: string | null, cible: string | null, nature: string }[],
 * }} Verdict
 */

/**
 * Premier étage : la PR relève-t-elle de la politique automatique ?
 * N'interroge que ce qui ne change pas tant que le commit de tête ne change pas.
 *
 * @param {Pr} pr
 * @param {Commit[]} commits
 * @param {string[]} fichiers
 * @param {string} depot `propriétaire/nom` du dépôt courant
 * @returns {{ bloquant: string[], dependances: Verdict['dependances'], aVerifier: { nom: string, depart: string, cible: string }[] }}
 */
export function examinerPolitique(pr, commits, fichiers, depot) {
  /** @type {string[]} */
  const bloquant = [];

  // 1) Provenance. Tout est vérifié, parce qu'un seul critère se contourne :
  //    un humain avec droit d'écriture peut pousser sur une branche Dependabot.
  if (pr.auteur.login !== AUTEUR_DEPENDABOT || pr.auteur.type !== 'Bot') {
    bloquant.push('auteur autre que Dependabot');
  }
  if (pr.depotTete !== depot || pr.depotBase !== depot) {
    bloquant.push('branche hors du dépôt (fork)');
  }
  if (!pr.brancheTete.startsWith('dependabot/')) {
    bloquant.push('branche hors de l’espace dependabot/');
  }
  if (pr.brouillon) bloquant.push('PR en brouillon');
  if (commits.length !== 1) {
    bloquant.push(
      `${commits.length} commits au lieu d’un seul (commit ajouté à la main ?)`,
    );
  }
  for (const c of commits) {
    if (c.auteur !== AUTEUR_DEPENDABOT) {
      bloquant.push(`commit ${c.sha.slice(0, 7)} d’un autre auteur`);
    }
    if (!c.verifie) {
      bloquant.push(`commit ${c.sha.slice(0, 7)} sans signature vérifiée`);
    }
  }
  if (commits.length > 0 && commits.at(-1)?.sha !== pr.shaTete) {
    bloquant.push('commit de tête incohérent avec la liste des commits');
  }

  // 2) Écosystème : seul npm est dans le périmètre automatique.
  const ecosysteme = pr.brancheTete.split('/')[1] ?? '';
  if (ecosysteme === 'github_actions') {
    bloquant.push('action GitHub : modifie un workflow, donc un gate');
  } else if (ecosysteme === 'docker' || ecosysteme === 'docker_compose') {
    bloquant.push(
      'image Docker : les correctifs de sécurité qu’elle embarque ne sont pas traçables',
    );
  } else if (ecosysteme !== 'npm_and_yarn') {
    bloquant.push(`écosystème « ${ecosysteme || 'inconnu'} » hors périmètre`);
  }

  // 3) Fichiers touchés.
  if (fichiers.length === 0) bloquant.push('liste des fichiers illisible');
  const horsPerimetre = fichiers.filter(
    (f) => !FICHIERS_AUTORISES.some((r) => r.test(f)),
  );
  if (horsPerimetre.length > 0) {
    bloquant.push(
      `touche des fichiers hors manifestes : ${horsPerimetre.slice(0, 3).join(', ')}${horsPerimetre.length > 3 ? '…' : ''}`,
    );
  }

  // 4) Dépendances : nature de la montée, outillage des gates.
  const metadonnees = lireMetadonnees(commits[0]?.message ?? '');
  const departs = lireVersionsDepart(pr.corps);
  if (metadonnees.length === 0) {
    bloquant.push('métadonnées Dependabot illisibles');
  }
  /** @type {Verdict['dependances']} */
  const dependances = [];
  /** @type {{ nom: string, depart: string, cible: string }[]} */
  const aVerifier = [];
  for (const d of metadonnees) {
    const depart = departs.get(d.nom) ?? null;
    const cible = d.versionCible;
    const calculee =
      depart !== null && cible !== null
        ? natureMontee(depart, cible)
        : 'illisible';
    const annoncee = etiquetteDependabot(d.typeMaj);
    // La plus sévère des deux lectures l'emporte.
    const nature = RANG[calculee] >= RANG[annoncee] ? calculee : annoncee;
    dependances.push({ nom: d.nom, depart, cible, nature });

    if (nature === 'illisible') {
      bloquant.push(`${d.nom} : versions illisibles`);
    } else if (nature === 'major') {
      bloquant.push(
        `${d.nom} ${depart} → ${cible} : majeure${depart?.startsWith('0.') ? ' (0.x : rupture permise par SemVer)' : ''}`,
      );
    }
    if (toucheUnGate(d.nom)) {
      bloquant.push(`${d.nom} : outillage d’un gate`);
    }
    if (d.typeDependance !== null && !d.typeDependance.startsWith('direct:')) {
      bloquant.push(`${d.nom} : dépendance indirecte (${d.typeDependance})`);
    }
    if (depart !== null && cible !== null) {
      aVerifier.push({ nom: d.nom, depart, cible });
    }
  }
  return { bloquant, dependances, aVerifier };
}

/**
 * Second étage : les avis de sécurité. Une version de DÉPART touchée par un avis
 * fait de la PR une mise à jour de sécurité — quelle que soit la façon dont
 * Dependabot l'a ouverte, y compris une simple mise à jour de version qui, en
 * passant, corrige une faille. Une version CIBLE touchée bloque aussi : on ne
 * fusionne pas vers une version vulnérable.
 *
 * @param {Avis[]} avisDepart
 * @param {Avis[]} avisCible
 * @returns {{ securite: string[], bloquant: string[] }}
 */
export function examinerAvis(avisDepart, avisCible) {
  /** @type {string[]} */
  const securite = [];
  /** @type {string[]} */
  const bloquant = [];
  for (const a of avisDepart) {
    if (!a.ok)
      bloquant.push(`${a.nom} : avis de sécurité illisibles (${a.erreur})`);
    else if (a.avis.length > 0) {
      securite.push(
        `${a.nom} : corrige ${a.avis.map((x) => `${x.ghsa} (${x.severite})`).join(', ')}`,
      );
    }
  }
  for (const a of avisCible) {
    if (!a.ok)
      bloquant.push(`${a.nom} : avis de sécurité illisibles (${a.erreur})`);
    else if (a.avis.length > 0) {
      bloquant.push(`${a.nom} : la version cible reste vulnérable`);
    }
  }
  return { securite, bloquant };
}

/**
 * Troisième étage : l'état des contrôles SUR LE COMMIT DE TÊTE, et la
 * possibilité de fusionner. C'est la seule partie qui change d'un passage à
 * l'autre (CI qui termine, rebase de Dependabot).
 *
 * @param {Controle[]} controles check runs du commit de tête (toutes pages)
 * @param {{ contexte: string, etat: string }[]} statuts statuts de commit
 * @param {string} etatFusion `mergeable_state` de l'API
 * @returns {{ attente: string[], echec: string[] }}
 */
export function examinerControles(controles, statuts, etatFusion) {
  /** @type {string[]} */
  const attente = [];
  /** @type {string[]} */
  const echec = [];

  // Un même nom peut porter plusieurs runs (relance) : le plus récent compte,
  // l'API les rend du plus récent au plus ancien.
  /** @type {Map<string, Controle>} */
  const parNom = new Map();
  for (const c of controles) if (!parNom.has(c.nom)) parNom.set(c.nom, c);

  for (const attendu of CONTROLES_ATTENDUS) {
    if (!parNom.has(attendu))
      attente.push(`contrôle « ${attendu} » pas encore rapporté`);
  }
  for (const c of parNom.values()) {
    if (c.statut !== 'completed') attente.push(`« ${c.nom} » en cours`);
    else if (!CONCLUSIONS_VERTES.has(c.conclusion ?? '')) {
      echec.push(`« ${c.nom} » : ${c.conclusion ?? 'sans conclusion'}`);
    }
  }
  for (const s of statuts) {
    if (s.etat === 'pending')
      attente.push(`statut « ${s.contexte} » en attente`);
    else if (s.etat !== 'success')
      echec.push(`statut « ${s.contexte} » : ${s.etat}`);
  }

  if (etatFusion === 'behind') {
    attente.push(
      'en retard sur main : Dependabot va la rebaser, la CI repartira',
    );
  } else if (etatFusion === 'dirty') {
    echec.push('conflit avec main');
  } else if (etatFusion === 'unknown' || etatFusion === '') {
    attente.push('mergeabilité pas encore calculée par GitHub');
  } else if (
    etatFusion !== 'clean' &&
    etatFusion !== 'has_hooks' &&
    echec.length === 0 &&
    attente.length === 0
  ) {
    // `blocked`/`unstable` sans cause visible ci-dessus : GitHub voit quelque
    // chose que ce tri ne voit pas. On ne fusionne pas sur un désaccord.
    echec.push(
      `GitHub refuse la fusion (état « ${etatFusion} ») malgré des contrôles verts`,
    );
  }
  return { attente, echec };
}

/**
 * Assemble les trois étages en une décision.
 *
 * Ordre de priorité : la sécurité d'abord (elle doit être VUE, même si la CI
 * est rouge), puis ce qui relève de la main, puis l'attente.
 *
 * @param {ReturnType<typeof examinerPolitique>} politique
 * @param {ReturnType<typeof examinerAvis>} avis
 * @param {ReturnType<typeof examinerControles>} controles
 * @returns {Verdict}
 */
export function decider(politique, avis, controles) {
  const dependances = politique.dependances;
  if (avis.securite.length > 0) {
    return {
      decision: 'securite',
      raisons: [
        ...avis.securite,
        ...politique.bloquant,
        ...avis.bloquant,
        ...controles.echec,
      ],
      dependances,
    };
  }
  const aLaMain = [...politique.bloquant, ...avis.bloquant, ...controles.echec];
  if (aLaMain.length > 0) {
    return { decision: 'a-la-main', raisons: aLaMain, dependances };
  }
  if (controles.attente.length > 0) {
    return { decision: 'attente', raisons: controles.attente, dependances };
  }
  return { decision: 'prete', raisons: [], dependances };
}
